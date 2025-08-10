import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// Check if secret key exists
if (!process.env.STRIPE_SECRET_KEY) {
  console.error('STRIPE_SECRET_KEY is not set in environment variables');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

export async function POST(request: NextRequest) {
  console.log('Payment Intent API called');
  
  try {
    const { amount, currency = 'usd', userId } = await request.json();
    
    console.log('Creating payment intent for:', { amount, currency, userId });

    // Create a PaymentIntent with the order amount and currency
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100, // Convert to cents
      currency: currency,
      metadata: {
        userId: userId,
        product: 'nara-premium'
      },
      // Enable automatic payment methods
      automatic_payment_methods: {
        enabled: true,
      },
    });

    console.log('Payment intent created successfully:', paymentIntent.id);

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (err: any) {
    console.error('Payment intent creation failed:', err);
    return NextResponse.json(
      { error: err.message },
      { status: 400 }
    );
  }
}