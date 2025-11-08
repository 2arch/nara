import { NextRequest, NextResponse } from 'next/server';
import { stripe, STRIPE_PLANS, PLAN_DETAILS } from '../config';

export async function POST(request: NextRequest) {
  try {
    if (!stripe) {
      return NextResponse.json(
        { error: 'Stripe not configured' },
        { status: 500 }
      );
    }

    const { plan, interval, userId } = await request.json();

    // Validate input
    if (!userId) {
      return NextResponse.json(
        { error: 'Missing required field: userId' },
        { status: 400 }
      );
    }

    // For simple pro plan, we only accept 'pro' and 'monthly'
    const planName = plan || 'pro';
    const intervalName = interval || 'monthly';

    if (planName !== 'pro') {
      return NextResponse.json(
        { error: 'Invalid plan. Only "pro" is available.' },
        { status: 400 }
      );
    }

    if (intervalName !== 'monthly') {
      return NextResponse.json(
        { error: 'Invalid interval. Only "monthly" is available.' },
        { status: 400 }
      );
    }

    // Get the price ID
    const priceId = STRIPE_PLANS.pro.monthly;

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://nara.ws'}/?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://nara.ws'}`,
      metadata: {
        userId,
        plan: planName,
        interval: intervalName,
      },
      subscription_data: {
        metadata: {
          userId,
          plan: planName,
          interval: intervalName,
        },
      },
    });

    return NextResponse.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}