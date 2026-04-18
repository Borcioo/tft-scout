<?php

namespace App\Http\Controllers;

use App\Http\Middleware\RevalidateMetaTft;
use App\Models\MetaSync;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * Read-only diagnostics endpoints gated by DIAGNOSTICS_KEY env var.
 *
 * Purpose: avoid SSH-ing to prod every time something looks off with
 * the MetaTFT sync pipeline. No persistence, no mutations — just
 * snapshot DB/cache/log state into one JSON response.
 *
 * Auth: query param `key` OR header `X-Diagnostics-Key`. Missing env
 * var = endpoint returns 404 (don't leak existence of the route).
 */
class DiagnosticsController extends Controller
{
    public function metaSync(Request $request): JsonResponse|Response
    {
        $expected = env('DIAGNOSTICS_KEY');
        if (! is_string($expected) || $expected === '') {
            // Feature-flagged off. Return a generic 404 so the route
            // is invisible on servers where it's not configured.
            abort(404);
        }

        $provided = $request->query('key') ?? $request->header('X-Diagnostics-Key');
        if (! is_string($provided) || ! hash_equals($expected, $provided)) {
            abort(404); // Same 404 — no "wrong key" signal.
        }

        $setNumber = (int) config('services.tft.set', 17);

        return response()->json([
            'server_time' => now()->toIso8601String(),
            'set_number' => $setNumber,
            'last_sync' => $this->lastSync($setNumber),
            'cache_flags' => $this->cacheFlags($setNumber),
            'cache_locks' => $this->cacheLocks(),
            'queue' => $this->queueState(),
            'db_activity' => $this->dbActivity(),
            'recent_logs' => $this->recentLogLines(),
        ]);
    }

    private function lastSync(int $setNumber): ?array
    {
        $row = MetaSync::query()
            ->whereHas('set', fn ($q) => $q->where('number', $setNumber))
            ->orderByDesc('synced_at')
            ->first();
        if (! $row) {
            return null;
        }

        return [
            'id' => $row->id,
            'synced_at' => $row->synced_at?->toIso8601String(),
            'minutes_ago' => $row->synced_at ? (int) $row->synced_at->diffInMinutes(now()) : null,
            'status' => $row->status,
            'notes' => $row->notes ? mb_substr($row->notes, 0, 200) : null,
            'units' => $row->units_count,
            'traits' => $row->traits_count,
            'affinity' => $row->affinity_count,
            'companions' => $row->companions_count,
            'meta_comps' => $row->meta_comps_count,
            'item_stats' => $row->item_stats_count,
            'item_builds' => $row->item_builds_count,
            'failed_item_champions' => $row->failed_item_champions,
        ];
    }

    private function cacheFlags(int $setNumber): array
    {
        return [
            'refresh_active' => Cache::has(RevalidateMetaTft::activeKey($setNumber)),
            'refresh_lock' => Cache::has(RevalidateMetaTft::lockKey($setNumber)),
            'stale_gate' => Cache::has('meta:stale-gate'),
        ];
    }

    private function cacheLocks(): array
    {
        try {
            return DB::table('cache_locks')
                ->where('key', 'like', '%meta%')
                ->get()
                ->map(fn ($row) => [
                    'key' => $row->key,
                    'expiration' => date('c', (int) $row->expiration),
                    'seconds_left' => (int) $row->expiration - time(),
                ])
                ->all();
        } catch (\Throwable $e) {
            return ['error' => $e->getMessage()];
        }
    }

    private function queueState(): array
    {
        $jobs = DB::table('jobs')
            ->orderBy('available_at')
            ->limit(5)
            ->get(['id', 'attempts', 'reserved_at', 'available_at', 'created_at']);

        $failedCount = DB::table('failed_jobs')->count();
        $lastFailed = DB::table('failed_jobs')
            ->orderByDesc('failed_at')
            ->first(['failed_at', 'exception']);

        return [
            'pending' => $jobs->count(),
            'jobs' => $jobs->map(fn ($j) => [
                'id' => $j->id,
                'attempts' => $j->attempts,
                'reserved_at' => $j->reserved_at ? date('c', (int) $j->reserved_at) : null,
                'available_at' => date('c', (int) $j->available_at),
                'created_at' => date('c', (int) $j->created_at),
            ])->all(),
            'failed_total' => $failedCount,
            'last_failed' => $lastFailed ? [
                'failed_at' => $lastFailed->failed_at,
                // First line of the exception is usually the message.
                'message' => trim(explode("\n", $lastFailed->exception)[0] ?? ''),
            ] : null,
        ];
    }

    private function dbActivity(): array
    {
        try {
            $rows = DB::select("
                SELECT pid,
                       state,
                       EXTRACT(EPOCH FROM (now() - query_start))::int as query_sec,
                       EXTRACT(EPOCH FROM (now() - xact_start))::int as xact_sec,
                       substring(query, 1, 200) as query
                FROM pg_stat_activity
                WHERE pid != pg_backend_pid()
                  AND (state = 'active' OR xact_start IS NOT NULL)
                ORDER BY xact_start NULLS LAST
                LIMIT 10
            ");

            return array_map(fn ($r) => (array) $r, $rows);
        } catch (\Throwable $e) {
            return ['error' => $e->getMessage()];
        }
    }

    private function recentLogLines(int $lines = 40): array
    {
        $path = storage_path('logs/laravel.log');
        if (! is_readable($path)) {
            return [];
        }

        // Read last ~64KB — enough for 40 lines without loading huge file.
        $size = filesize($path);
        $read = min($size, 64 * 1024);
        $fh = fopen($path, 'rb');
        if (! $fh) {
            return [];
        }
        fseek($fh, -$read, SEEK_END);
        $chunk = (string) fread($fh, $read);
        fclose($fh);

        $all = explode("\n", $chunk);
        // Filter to meta/sync/queue-relevant noise so the payload stays small.
        $relevant = array_values(array_filter(
            $all,
            fn ($line) => $line !== ''
                && (stripos($line, 'meta') !== false
                    || stripos($line, 'sync') !== false
                    || stripos($line, 'queue') !== false
                    || stripos($line, 'RefreshMetaTft') !== false),
        ));

        return array_slice($relevant, -$lines);
    }
}
