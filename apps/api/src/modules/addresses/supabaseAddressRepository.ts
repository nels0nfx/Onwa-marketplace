import type { SupabaseClient } from '@supabase/supabase-js';
import type { Address, AddressInput } from '@onwa/shared';
import type { AddressRepository } from '../../deps.js';
import { mapDbError } from '../../lib/dbErrors.js';
import { notFound } from '../../lib/errors.js';

const COLUMNS = 'id,label,recipient_name,phone,line1,line2,city,lga,state,landmark,postal_code,is_default';

interface Row {
  id: string; label: string; recipient_name: string; phone: string; line1: string; line2: string | null;
  city: string; lga: string; state: string; landmark: string | null; postal_code: string | null; is_default: boolean;
}

const toAddress = (r: Row): Address => ({
  id: r.id, label: r.label, recipientName: r.recipient_name, phone: r.phone, line1: r.line1, line2: r.line2,
  city: r.city, lga: r.lga, state: r.state, landmark: r.landmark, postalCode: r.postal_code, isDefault: r.is_default,
});

const toColumns = (i: AddressInput) => ({
  label: i.label, recipient_name: i.recipientName, phone: i.phone, line1: i.line1, line2: i.line2 ?? null,
  city: i.city, lga: i.lga, state: i.state, landmark: i.landmark ?? null, postal_code: i.postalCode ?? null,
  ...(i.isDefault !== undefined ? { is_default: i.isDefault } : {}),
});

export class SupabaseAddressRepository implements AddressRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(userId: string): Promise<Address[]> {
    const { data, error } = await this.db.from('addresses').select(COLUMNS).eq('user_id', userId)
      .order('is_default', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw mapDbError(error);
    return ((data ?? []) as Row[]).map(toAddress);
  }

  async create(userId: string, input: AddressInput): Promise<Address> {
    const { data, error } = await this.db.from('addresses').insert({ user_id: userId, ...toColumns(input) }).select(COLUMNS).single();
    if (error) throw mapDbError(error);
    return toAddress(data as Row);
  }

  async replace(userId: string, id: string, input: AddressInput): Promise<Address> {
    const { data, error } = await this.db.from('addresses').update(toColumns(input)).eq('id', id).eq('user_id', userId).select(COLUMNS).maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) throw notFound('Address not found');
    return toAddress(data as Row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const { data, error } = await this.db.from('addresses').delete().eq('id', id).eq('user_id', userId).select('id');
    if (error) throw mapDbError(error);
    if (!data || data.length === 0) throw notFound('Address not found');
  }
}
