<?php

namespace App\Casts;

use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;

/**
 * Eloquent cast for Postgres native array columns (e.g., text[], int[]).
 *
 * Laravel's built-in 'array' cast is JSON-based and doesn't understand
 * Postgres array literal format `{a,b,c}` or `{"with quotes","and, commas"}`.
 *
 * Usage in model:
 *   protected $casts = [
 *       'tags' => PostgresArray::class,
 *   ];
 *
 * After the cast, `$model->tags` is a PHP array and assignment works naturally:
 *   $item->tags = ['AttackDamage', 'Health'];
 *   $item->save();
 */
class PostgresArray implements CastsAttributes
{
    /**
     * Parse Postgres array literal to PHP array.
     */
    public function get(Model $model, string $key, mixed $value, array $attributes): ?array
    {
        if ($value === null) {
            return null;
        }

        if (is_array($value)) {
            return $value;
        }

        $trimmed = trim((string) $value, '{}');

        if ($trimmed === '') {
            return [];
        }

        // str_getcsv handles the common case: unquoted simple tokens
        // and double-quoted strings with embedded commas. Postgres-specific
        // backslash escaping inside quoted elements is rare for our use case
        // (filtered tags are ASCII word-like strings).
        return str_getcsv($trimmed, ',', '"', '\\');
    }

    /**
     * Format PHP array as Postgres array literal.
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        if ($value === null) {
            return null;
        }

        // Allow passing a pre-formatted Postgres literal through untouched
        // (useful for raw DB operations).
        if (is_string($value)) {
            return $value;
        }

        if (! is_array($value)) {
            throw new \InvalidArgumentException(
                "PostgresArray cast expects array or string, got ".gettype($value)
            );
        }

        // Quote each element, escaping embedded quotes and backslashes
        $escaped = array_map(function ($element) {
            if ($element === null) {
                return 'NULL';
            }

            $escaped = str_replace(['\\', '"'], ['\\\\', '\\"'], (string) $element);

            return '"'.$escaped.'"';
        }, $value);

        return '{'.implode(',', $escaped).'}';
    }
}
