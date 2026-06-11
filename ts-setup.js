'use strict';
// Gets a Truth Social access token for the bot.
// Run: node ts-setup.js
const axios    = require('axios');
const readline = require('readline');

const BASE = 'https://truthsocial.com';

const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(res => rl.question(q, res));

async function main() {
  console.log('=== CivicPulse — Truth Social Setup ===\n');
  console.log('This will register the bot as an app on your Truth Social account');
  console.log('and generate an access token.\n');

  // Step 1 — register the app
  console.log('Step 1/3: Registering app with Truth Social...');
  let app;
  try {
    const res = await axios.post(`${BASE}/api/v1/apps`, {
      client_name:   'CivicPulse Bot',
      redirect_uris: 'urn:ietf:wg:oauth:2.0:oob',
      scopes:        'read write',
      website:       'https://civicpulse.app',
    }, { timeout: 15000 });
    app = res.data;
    console.log('✓ App registered\n');
  } catch (e) {
    console.error('Failed to register app:', e.response?.data || e.message);
    process.exit(1);
  }

  // Step 2 — get credentials
  const email    = await ask('Step 2/3: Enter your Truth Social email: ');
  const password = await ask('         Enter your Truth Social password: ');
  rl.close();
  console.log();

  // Step 3 — request token via password grant
  console.log('Step 3/3: Requesting access token...');
  try {
    const res = await axios.post(`${BASE}/oauth/token`, {
      grant_type:    'password',
      username:      email,
      password,
      client_id:     app.client_id,
      client_secret: app.client_secret,
      scope:         'read write',
    }, { timeout: 15000 });

    const token = res.data.access_token;
    console.log('\n✓ Success!\n');
    console.log('Add this line to your .env file:\n');
    console.log(`TS_ACCESS_TOKEN=${token}`);
    console.log('\nAnd add it to Render → Environment tab as TS_ACCESS_TOKEN');
  } catch (e) {
    const err = e.response?.data;
    console.error('\nFailed to get token:', err?.error_description || err?.error || e.message);
    if (err?.error === 'invalid_grant') {
      console.error('Check your email and password and try again.');
    }
    process.exit(1);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
