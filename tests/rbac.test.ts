import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  can,
  canInScope,
  capabilitiesFor,
  scopedEntityIds,
  type Grant
} from '@/lib/rbac';

const PUBLIC_SERVICE = '11111111-1111-1111-1111-111111111111';
const STUDIOS = '22222222-2222-2222-2222-222222222222';

describe('role scoping', () => {
  const studiosApprover: Grant[] = [
    { role: 'approver', scope: 'entity', entityId: STUDIOS }
  ];

  it('permits a scoped decision on the granted entity', () => {
    assert.equal(can(studiosApprover, 'approval.decide', STUDIOS), true);
  });

  it('refuses the same decision on another entity', () => {
    assert.equal(
      can(studiosApprover, 'approval.decide', PUBLIC_SERVICE),
      false
    );
  });

  it('lets an organisation grant satisfy an entity-scoped question', () => {
    const admin: Grant[] = [{ role: 'privacy_admin', scope: 'organisation' }];
    assert.equal(can(admin, 'record.write', STUDIOS), true);
  });

  it('reports which entities a capability reaches', () => {
    assert.deepEqual(scopedEntityIds(studiosApprover, 'approval.decide'), [
      STUDIOS
    ]);
  });

  it('reports null for organisation-wide reach', () => {
    const admin: Grant[] = [{ role: 'privacy_admin', scope: 'organisation' }];
    assert.equal(scopedEntityIds(admin, 'record.write'), null);
  });
});

describe('role definitions', () => {
  it('keeps accepting a risk away from administrative roles', () => {
    // Accepting a risk carries personal accountability. It belongs to an
    // approver, never to whoever happens to administer the platform.
    assert.equal(
      capabilitiesFor('privacy_admin').includes('risk.accept'),
      false
    );
    assert.equal(
      capabilitiesFor('privacy_analyst').includes('risk.accept'),
      false
    );
    assert.equal(capabilitiesFor('approver').includes('risk.accept'), true);
  });

  it('keeps an auditor read-only', () => {
    const writes = capabilitiesFor('auditor').filter(
      (c) => !c.endsWith('.read') && !c.endsWith('.export')
    );
    assert.deepEqual(writes, []);
  });

  it('limits a contributor to answering questions, and sending a section on', () => {
    // Sending a section to somebody without an account is reaching outside,
    // which a contributor always could and a trial never can.
    assert.deepEqual(capabilitiesFor('contributor'), [
      'assessment.answer',
      'contact.outside'
    ]);
  });
});

describe('records for every entity', () => {
  const studiosAdmin: Grant[] = [
    { role: 'privacy_admin', scope: 'entity', entityId: STUDIOS }
  ];
  const admin: Grant[] = [{ role: 'privacy_admin', scope: 'organisation' }];

  it('needs the capability across the organisation, not in one entity', () => {
    assert.equal(can(studiosAdmin, 'record.write'), true);
    assert.equal(canInScope(studiosAdmin, 'record.write', null), false);
    assert.equal(canInScope(admin, 'record.write', null), true);
  });

  it('is the entity check for a record of one entity', () => {
    assert.equal(canInScope(studiosAdmin, 'record.write', STUDIOS), true);
    assert.equal(
      canInScope(studiosAdmin, 'record.write', PUBLIC_SERVICE),
      false
    );
  });
});
