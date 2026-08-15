import { parseLocationForDB } from './location-parser';

/**
 * Update location_master table to parse and populate structured fields
 * This should be run once to migrate existing location codes
 */
export async function updateLocationMasterFields(db: any): Promise<{
  success: boolean;
  updated: number;
  message: string;
}> {
  try {
    // Get all locations that need parsing
    const locations = await db.query(
      `SELECT id, location_code 
       FROM location_master 
       WHERE location_code ~ '^[A-Z]{2}\\d{2}[A-E]\\d{2}$'
       AND (aisle IS NULL OR rack IS NULL OR row_name IS NULL OR position IS NULL)`
    );

    if (locations.rows.length === 0) {
      return {
        success: true,
        updated: 0,
        message: 'All locations already parsed',
      };
    }

    // Update each location
    let updated = 0;
    for (const loc of locations.rows) {
      const parsed = parseLocationForDB(loc.location_code);
      
      if (parsed.rack) {
        await db.query(
          `UPDATE location_master 
           SET aisle = $1, rack = $2, row_name = $3, position = $4
           WHERE id = $5`,
          [parsed.aisle, parsed.rack, parsed.row_name, parsed.position, loc.id]
        );
        updated++;
      }
    }

    return {
      success: true,
      updated,
      message: `Successfully parsed and updated ${updated} location(s)`,
    };
  } catch (error: any) {
    return {
      success: false,
      updated: 0,
      message: `Error updating locations: ${error.message}`,
    };
  }
}

/**
 * Batch update using SQL (more efficient for large datasets)
 */
export async function updateLocationMasterBatch(db: any): Promise<{
  success: boolean;
  updated: number;
  message: string;
}> {
  try {
    const result = await db.query(`
      UPDATE location_master
      SET 
        aisle = SUBSTRING(location_code, 1, 2),
        rack = SUBSTRING(location_code, 1, 4),
        row_name = SUBSTRING(location_code, 5, 1),
        position = SUBSTRING(location_code, 6, 2)
      WHERE 
        location_code ~ '^[A-Z]{2}\\d{2}[A-E]\\d{2}$'
        AND (aisle IS NULL OR rack IS NULL OR row_name IS NULL OR position IS NULL)
    `);

    return {
      success: true,
      updated: result.rowCount || 0,
      message: `Successfully parsed and updated ${result.rowCount || 0} location(s)`,
    };
  } catch (error: any) {
    return {
      success: false,
      updated: 0,
      message: `Error updating locations: ${error.message}`,
    };
  }
}
