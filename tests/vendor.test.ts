import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoIcon, providerMark, letterHue } from '../src/ui/vendor';
import { presets } from '../src/core/presets';
import { providerSchema } from '../src/core/types';
import { vendorMarks } from '../src/ui/marks';

const api = (baseUrl: string) => ({ app: 'claude' as const, mode: 'api' as const, baseUrl, loginProvider: 'anthropic' });
test('the vendor mark follows the Base URL host, the login, or an explicit choice', () => {
  assert.equal(autoIcon(api('https://api.deepseek.com/anthropic')), 'deepseek');
  assert.equal(autoIcon(api('https://ark.cn-beijing.volces.com/api/coding')), 'volcengine');
  assert.equal(autoIcon(api('https://open.bigmodel.cn/api/anthropic')), 'zhipu');
  assert.equal(autoIcon(api('https://api.z.ai/api/anthropic')), 'zai');
  // Case, port and the DNS root dot do not change the host.
  assert.equal(autoIcon(api('https://API.DEEPSEEK.COM:443/v1')), 'deepseek');
  assert.equal(autoIcon(api('https://api.deepseek.com./v1')), 'deepseek');
  // A look-alike host is not the vendor, and an unknown gateway gets the letter avatar.
  assert.equal(autoIcon(api('https://deepseek.com.evil.example/v1')), null);
  assert.equal(autoIcon(api('https://gateway.example.com')), null);
  assert.equal(autoIcon({ app: 'chatgpt', mode: 'login', baseUrl: '', loginProvider: 'anthropic' }), 'openai');
  assert.equal(autoIcon({ app: 'pi', mode: 'login', baseUrl: '', loginProvider: 'anthropic' }), 'claude');
  assert.equal(autoIcon({ app: 'pi', mode: 'login', baseUrl: '', loginProvider: 'opencode' }), null);
  // Provider IDs that name inherited object properties find nothing.
  for (const id of ['__proto__', 'constructor', 'toString']) assert.equal(autoIcon({ app: 'pi', mode: 'login', baseUrl: '', loginProvider: id }), null);
  assert.equal(providerMark({ ...api('https://api.deepseek.com'), icon: 'not-a-vendor' as never }), 'deepseek');
  assert.equal(providerMark({ ...api('https://api.deepseek.com'), icon: 'letter' }), null);
  assert.equal(providerMark({ ...api('https://gateway.example.com'), icon: 'kimi' }), 'kimi');
  assert.equal(letterHue('工作网关'), letterHue('工作网关'));
});

test('every preset endpoint resolves to a vendor mark, and every mark is drawn', () => {
  for (const preset of presets) for (const fields of Object.values(preset.apps)) {
    if (fields?.mode === 'login' || !fields?.baseUrl) continue;
    assert.ok(autoIcon(api(fields.baseUrl)), `${preset.id} ${fields.baseUrl}`);
  }
  for (const mark of Object.values(vendorMarks)) assert.match(mark.svg, /^<svg aria-hidden="true"[^>]*viewBox="0 0 24 24"/);
  assert.equal(providerSchema.safeParse({ app: 'claude', name: 'x', mode: 'login', model: 'm', protocol: 'anthropic-messages', icon: 'nope' }).success, false);
});
