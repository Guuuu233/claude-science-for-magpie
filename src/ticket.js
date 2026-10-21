import { randomBytes, randomUUID, hkdfSync, createCipheriv } from 'node:crypto';

// This is a local launch identity, never an Anthropic credential.
// Science v0.1.60 uses v2 AES-GCM records with this HKDF domain and AAD.
export function makeTicket(existingKeys, accessToken='magpie-claude-science') {
  const names = ['ANTHROPIC_API_KEY_ENCRYPTION_KEY','OAUTH_ENCRYPTION_KEY','JWT_SIGNING_SECRET','USER_SECRET_ENCRYPTION_KEY'];
  const keys = existingKeys ? {...existingKeys} : Object.fromEntries(names.map(n=>[n,randomBytes(32).toString('base64')]));
  for (const n of names) {
    if (typeof keys[n] !== 'string' || Buffer.from(keys[n],'base64').length < 16) throw new Error(`Invalid encryption key: ${n}`);
  }
  const account=randomUUID(), org=randomUUID();
  const blob={access_token:accessToken,refresh_token:'',api_key:null,
    token_expires_at:'2099-01-01T00:00:00.000Z',provider:'claude_ai',
    scopes:'user:inference user:file_upload user:profile user:mcp_servers user:plugins',email:'science@localhost.invalid',
    account_uuid:account,org_uuid:org,subscription_type:'max',rate_limit_tier:null,
    seat_tier:null,billing_type:null,has_extra_usage_enabled:false};
  const key=hkdfSync('sha256',Buffer.from(keys.OAUTH_ENCRYPTION_KEY,'base64'),Buffer.alloc(0),'operon:aes-256-gcm:oauth',32);
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from('v2:oauth'));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(blob)),cipher.final()]);
  return {account,org,keys,encrypted:'v2:'+Buffer.concat([iv,ciphertext,cipher.getAuthTag()]).toString('base64')};
}
