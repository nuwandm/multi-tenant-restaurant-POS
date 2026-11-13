import type { TransactionSql } from 'postgres';
import { HttpError } from '../errors';

export interface LockedRegister {
  id: string;
  restaurantId: string;
  designation: string;
  controlSystemRef: string | null;
  createdAt: Date;
  /** As printed on receipts (7 kap. 1 § a–b SKVFS 2014:9). */
  seller: { legalName: string; orgNumber: string; address: string | null };
  /** End of the last Z period, if any. New receipts must be dated after it. */
  lastZPeriodTo: Date | null;
}

interface RegisterRow {
  restaurant_id: string;
  designation: string;
  status: 'active' | 'retired';
  control_system_ref: string | null;
  created_at: Date;
  legal_name: string;
  org_number: string;
  address: string | null;
  last_z_period_to: Date | null;
  tenant_status: 'pending' | 'active' | 'suspended';
}

/**
 * Locks the register row for the rest of the transaction. Every sale, return, copy and report
 * on a register takes this lock first, so they run one at a time and a Z report sees exactly
 * the receipts committed before it.
 */
export async function lockRegister(
  tx: TransactionSql,
  registerId: string,
  options: { forSelling: boolean; allowPending?: boolean },
): Promise<LockedRegister> {
  const [row] = await tx<RegisterRow[]>`
    SELECT r.restaurant_id, r.designation, r.status, r.control_system_ref, r.created_at,
           t.legal_name, t.org_number, t.status AS tenant_status, s.address,
           (SELECT max(period_to) FROM z_reports z WHERE z.register_id = r.id) AS last_z_period_to
    FROM cash_registers r JOIN tenants t ON t.id = r.tenant_id
    JOIN restaurants s ON s.id = r.restaurant_id
    WHERE r.id = ${registerId}
    FOR UPDATE OF r`;
  if (!row) throw new HttpError(404, 'register_not_found', 'Register not found');

  if (options.forSelling) {
    const trainingWhilePending = options.allowPending && row.tenant_status === 'pending';
    if (row.tenant_status !== 'active' && !trainingWhilePending) {
      throw new HttpError(
        409,
        row.tenant_status === 'pending' ? 'company_pending' : 'company_suspended',
        row.tenant_status === 'pending'
          ? 'This company is waiting for approval and cannot sell yet'
          : 'This company is suspended and cannot sell',
      );
    }
    if (row.status !== 'active') {
      throw new HttpError(409, 'register_retired', 'This register is retired');
    }
    // Every receipt shows the address where the sale takes place (7 kap. 1 § b SKVFS 2014:9).
    if (!row.address?.trim()) {
      throw new HttpError(
        409,
        'restaurant_address_missing',
        'Add the restaurant address in the back office before selling',
      );
    }
    if (!row.control_system_ref) {
      throw new HttpError(
        409,
        'register_not_enrolled',
        'This register is not enrolled with the control system yet',
      );
    }
  }

  return {
    id: registerId,
    restaurantId: row.restaurant_id,
    designation: row.designation,
    controlSystemRef: row.control_system_ref,
    createdAt: row.created_at,
    seller: { legalName: row.legal_name, orgNumber: row.org_number, address: row.address },
    lastZPeriodTo: row.last_z_period_to,
  };
}

/** Now, but always after the last Z period, so no receipt can fall between two periods. */
export function receiptTimestamp(register: LockedRegister): Date {
  const now = new Date();
  const floor = register.lastZPeriodTo;
  return floor && now <= floor ? new Date(floor.getTime() + 1) : now;
}
