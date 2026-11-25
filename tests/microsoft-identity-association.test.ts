import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { GET } from '@/app/.well-known/microsoft-identity-association.json/route';

const saved = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
afterEach(() => {
  if (saved === undefined) delete process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
  else process.env.AUTH_MICROSOFT_ENTRA_ID_ID = saved;
});

describe('the Entra publisher domain file', () => {
  it("names the deployment's own Entra app", async () => {
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = 'app-id-under-test';
    const response = GET();
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('content-type') ?? '',
      /application\/json/
    );
    assert.deepEqual(await response.json(), {
      associatedApplications: [{ applicationId: 'app-id-under-test' }]
    });
  });

  it('is not found where Microsoft sign-in is not set up', () => {
    delete process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
    assert.equal(GET().status, 404);
  });
});
