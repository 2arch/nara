import { NextRequest, NextResponse } from 'next/server';
import { stripe, PLAN_DETAILS } from '../config';
import { database } from '@/app/firebase';
import { ref, update, get } from 'firebase/database';
import type { MembershipTier } from '@/app/firebase';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(request: NextRequest) {
  try {
    if (!stripe) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }

    const body = await request.text();
    const signature = request.headers.get('stripe-signature')!;

    let event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // Handle subscription events
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription') {
          await handleSubscriptionCreated(session);
        }
        break;
      }
      
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          await handleSubscriptionRenewed(invoice);
        }
        break;
      }
      
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        await handleSubscriptionUpdated(subscription);
        break;
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await handleSubscriptionCancelled(subscription);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}

async function handleSubscriptionCreated(session: any) {
  if (!stripe) {
    console.error('Stripe not configured');
    return;
  }

  const userId = session.metadata?.userId;
  const subscriptionId = session.subscription;
  
  if (!userId || !subscriptionId) {
    console.error('Missing userId or subscriptionId in session metadata');
    return;
  }

  // Get subscription details
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const priceId = subscription.items.data[0]?.price.id;
  
  if (!priceId || !PLAN_DETAILS[priceId as keyof typeof PLAN_DETAILS]) {
    console.error('Invalid or missing price ID:', priceId);
    return;
  }

  const planDetails = PLAN_DETAILS[priceId as keyof typeof PLAN_DETAILS];
  const expiry = new Date(subscription.current_period_end * 1000).toISOString();

  // Update user in Firebase
  await updateUserSubscription(userId, {
    membership: planDetails.tier as MembershipTier,
    subscriptionId,
    planExpiry: expiry,
  });

  console.log(`Subscription created for user ${userId}: ${planDetails.tier} (${planDetails.interval})`);
}

async function handleSubscriptionRenewed(invoice: any) {
  if (!stripe) {
    console.error('Stripe not configured');
    return;
  }

  const subscriptionId = invoice.subscription;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = subscription.metadata?.userId;

  if (!userId) {
    console.error('Missing userId in subscription metadata');
    return;
  }

  const expiry = new Date(subscription.current_period_end * 1000).toISOString();
  
  // Update expiry date
  await updateUserSubscription(userId, {
    planExpiry: expiry,
  });

  console.log(`Subscription renewed for user ${userId}, new expiry: ${expiry}`);
}

async function handleSubscriptionUpdated(subscription: any) {
  const userId = subscription.metadata?.userId;
  
  if (!userId) {
    console.error('Missing userId in subscription metadata');
    return;
  }

  const priceId = subscription.items.data[0]?.price.id;
  
  if (!priceId || !PLAN_DETAILS[priceId as keyof typeof PLAN_DETAILS]) {
    console.error('Invalid or missing price ID:', priceId);
    return;
  }

  const planDetails = PLAN_DETAILS[priceId as keyof typeof PLAN_DETAILS];
  const expiry = new Date(subscription.current_period_end * 1000).toISOString();

  // Update user subscription
  await updateUserSubscription(userId, {
    membership: planDetails.tier as MembershipTier,
    subscriptionId: subscription.id,
    planExpiry: expiry,
  });

  console.log(`Subscription updated for user ${userId}: ${planDetails.tier}`);
}

async function handleSubscriptionCancelled(subscription: any) {
  const userId = subscription.metadata?.userId;
  
  if (!userId) {
    console.error('Missing userId in subscription metadata');
    return;
  }

  // Downgrade to fresh tier
  await updateUserSubscription(userId, {
    membership: 'fresh' as MembershipTier,
    subscriptionId: null,
    planExpiry: null,
  });

  console.log(`Subscription cancelled for user ${userId}, downgraded to fresh`);
}

async function updateUserSubscription(userId: string, updates: {
  membership?: MembershipTier;
  subscriptionId?: string | null;
  planExpiry?: string | null;
}) {
  try {
    const userRef = ref(database, `users/${userId}`);
    
    // Remove null values
    const cleanUpdates = Object.entries(updates).reduce((acc, [key, value]) => {
      if (value !== null) {
        acc[key] = value;
      }
      return acc;
    }, {} as any);

    await update(userRef, cleanUpdates);
  } catch (error) {
    console.error('Error updating user subscription in Firebase:', error);
    throw error;
  }
}