import type { DatabaseHandle } from '../../database/connection.js';
import type { Match, Provider, ProviderMatchMapping } from '../../common/types/index.js';

interface MatchRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface MappingRow {
  id: number;
  provider: string;
  provider_match_id: string;
  match_id: string;
  created_at: string;
}

/**
 * Repository for match and provider mapping data.
 * Contains only database operations — no business logic.
 */
export class MatchRepository {
  constructor(private readonly db: DatabaseHandle) {}

  /** Find all matches */
  findAll(): Match[] {
    const rows = this.db
      .prepare('SELECT id, name, created_at, updated_at FROM matches ORDER BY id')
      .all() as MatchRow[];

    return rows.map(this.mapMatchRow);
  }

  /** Find a match by internal ID */
  findById(matchId: string): Match | undefined {
    const row = this.db
      .prepare('SELECT id, name, created_at, updated_at FROM matches WHERE id = ?')
      .get(matchId) as MatchRow | undefined;

    return row ? this.mapMatchRow(row) : undefined;
  }

  /** Resolve a provider's external match ID to the internal match ID */
  resolveMatchId(provider: Provider, providerMatchId: string): string | undefined {
    const row = this.db
      .prepare(
        'SELECT match_id FROM provider_match_mappings WHERE provider = ? AND provider_match_id = ?',
      )
      .get(provider, providerMatchId) as { match_id: string } | undefined;

    return row?.match_id;
  }

  /** Get all provider match mappings for a match */
  getMappings(matchId: string): ProviderMatchMapping[] {
    const rows = this.db
      .prepare(
        'SELECT id, provider, provider_match_id, match_id, created_at FROM provider_match_mappings WHERE match_id = ?',
      )
      .all(matchId) as MappingRow[];

    return rows.map((row) => ({
      id: row.id,
      provider: row.provider as Provider,
      providerMatchId: row.provider_match_id,
      matchId: row.match_id,
      createdAt: row.created_at,
    }));
  }

  private mapMatchRow(row: MatchRow): Match {
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
