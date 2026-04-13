<?php

namespace App\Services\Tft;

use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * Lazy loader for `tft.stringtable.json` — the ~21 MB per-locale blob
 * CDragon ships that maps RST hash keys to localised strings. Used by
 * AbilityDescriptionResolver to turn a plaintext loc key (e.g.
 * `Spell_TFT17_MissFortuneSpell_ManaTraitStance_Desc`) into the actual
 * description template.
 *
 * The file is too big to load fresh on every request (21 MB is slow to
 * fetch and to parse), so we:
 *
 *   1. Cache on disk at `storage/app/tft-cache/stringtable-{channel}-{locale}.json`
 *      between imports — survives process restarts, gitignored.
 *   2. Keep an in-memory `entries` array after first load in this process.
 *
 * On-disk cache has no TTL by design: the importer explicitly re-fetches
 * when it detects a new patch, and this class exposes a `refresh()` method
 * for manual invalidation.
 */
class StringtableCache
{
    private const CDRAGON_BASE = 'https://raw.communitydragon.org';
    private const CACHE_DIR = 'tft-cache';

    /** @var array<string, array<string, string>> Loaded stringtables keyed by "{channel}:{locale}" */
    private array $loaded = [];

    public function __construct(
        private readonly HttpFactory $http,
    ) {}

    /**
     * Get the entries map for a given channel + locale combo.
     *
     * @return array<string, string> RST hash key (wrapped) => translated text
     */
    public function entries(string $channel = 'pbe', string $locale = 'en_us'): array
    {
        $cacheKey = "{$channel}:{$locale}";
        if (isset($this->loaded[$cacheKey])) {
            return $this->loaded[$cacheKey];
        }

        $diskPath = $this->diskPath($channel, $locale);

        if (! Storage::exists($diskPath)) {
            $this->fetchAndStore($channel, $locale);
        }

        $raw = Storage::get($diskPath);
        $decoded = json_decode($raw, true);
        if (! is_array($decoded) || ! isset($decoded['entries']) || ! is_array($decoded['entries'])) {
            throw new RuntimeException("Stringtable cache is malformed: {$diskPath}");
        }

        $this->loaded[$cacheKey] = $decoded['entries'];

        return $decoded['entries'];
    }

    /**
     * Force re-download next time entries() is called. Use after detecting
     * a new patch to invalidate cached translations.
     */
    public function refresh(string $channel = 'pbe', string $locale = 'en_us'): void
    {
        unset($this->loaded["{$channel}:{$locale}"]);
        $path = $this->diskPath($channel, $locale);
        if (Storage::exists($path)) {
            Storage::delete($path);
        }
    }

    private function fetchAndStore(string $channel, string $locale): void
    {
        $url = sprintf(
            '%s/%s/game/%s/data/menu/en_us/tft.stringtable.json',
            self::CDRAGON_BASE,
            $channel,
            $locale,
        );

        $response = $this->http->timeout(120)->get($url);
        if ($response->failed()) {
            throw new RuntimeException("Stringtable fetch failed for {$url}: HTTP {$response->status()}");
        }

        Storage::put($this->diskPath($channel, $locale), $response->body());
    }

    private function diskPath(string $channel, string $locale): string
    {
        return sprintf('%s/stringtable-%s-%s.json', self::CACHE_DIR, $channel, $locale);
    }
}
