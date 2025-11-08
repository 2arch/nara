#!/usr/bin/env node

/**
 * Stripe Configuration Checker
 * This script checks which Stripe keys are configured and whether they're test or production keys
 */

console.log('🔍 Checking Stripe Configuration...\n');

const secretKey = process.env.STRIPE_SECRET_KEY;
const priceId = process.env.STRIPE_PRO_MONTHLY_PRICE_ID;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

function checkKey(name, value) {
  if (!value) {
    console.log(`❌ ${name}: NOT SET`);
    return false;
  }

  const isTest = value.startsWith('sk_test') || value.startsWith('whsec_test') || value.startsWith('price_test');
  const isLive = value.startsWith('sk_live') || value.startsWith('whsec_') || value.startsWith('price_');

  if (isTest) {
    console.log(`⚠️  ${name}: TEST MODE - ${value.substring(0, 15)}...`);
    return 'test';
  } else if (isLive && !isTest) {
    console.log(`✅ ${name}: PRODUCTION MODE - ${value.substring(0, 15)}...`);
    return 'live';
  } else {
    console.log(`❓ ${name}: UNKNOWN FORMAT - ${value.substring(0, 15)}...`);
    return 'unknown';
  }
}

console.log('Environment Variables:\n');
const secretStatus = checkKey('STRIPE_SECRET_KEY', secretKey);
const priceStatus = checkKey('STRIPE_PRO_MONTHLY_PRICE_ID', priceId);
const webhookStatus = checkKey('STRIPE_WEBHOOK_SECRET', webhookSecret);

console.log('\n📊 Summary:\n');

if (secretStatus === 'test' || priceStatus === 'test' || webhookStatus === 'test') {
  console.log('⚠️  WARNING: You are using TEST mode Stripe keys!');
  console.log('   This means:');
  console.log('   - No real payments will be processed');
  console.log('   - You can use test card numbers (4242 4242 4242 4242)');
  console.log('   - This is good for development/testing\n');
} else if (secretStatus === 'live' && priceStatus === 'live' && webhookStatus === 'live') {
  console.log('✅ All Stripe keys are in PRODUCTION mode');
  console.log('   This means:');
  console.log('   - Real payments will be processed');
  console.log('   - Real credit cards will be charged');
  console.log('   - This is the LIVE environment\n');
} else if (!secretKey || !priceId || !webhookSecret) {
  console.log('❌ Stripe is NOT fully configured');
  console.log('   Missing keys need to be set in your environment variables\n');
} else {
  console.log('⚠️  Mixed configuration detected - please review your keys\n');
}

console.log('💡 To check your production environment:');
console.log('   - If using Vercel: vercel env pull');
console.log('   - If using AWS/other: check your deployment platform\'s environment variables');
console.log('   - Check the Stripe dashboard at https://dashboard.stripe.com/test/apikeys (test) or https://dashboard.stripe.com/apikeys (live)\n');
