import Stripe from 'stripe';

// Only initialize Stripe if secret key is available (not during build)
export const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20',
    })
  : null;

// Stripe subscription products and pricing
export const STRIPE_PLANS = {
  pro: {
    monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID || 'price_pro_monthly',
  },
} as const;

// Plan metadata for easy lookup
export const PLAN_DETAILS = {
  [STRIPE_PLANS.pro.monthly]: { tier: 'pro', interval: 'month', price: 7.99 },
} as const;

export type StripePlan = keyof typeof PLAN_DETAILS;