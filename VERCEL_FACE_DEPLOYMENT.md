# Deploying Face Branch to Separate Vercel Project

This guide explains how to deploy the `face` branch as a separate Vercel project for testing the face-piloted geometry feature.

## ✅ Build Status
Build completed successfully! The face branch compiles without errors.

## Why a Separate Vercel Project?

Having a separate Vercel project for the face branch allows you to:
- **Test live** without affecting your main production deployment
- **Share demos** with a unique URL (e.g., `nara-face-demo.vercel.app`)
- **Iterate quickly** on the face detection feature
- **Compare** face branch vs main branch side-by-side

## Setup Instructions

### Option 1: Through Vercel Dashboard (Recommended)

1. **Go to Vercel Dashboard**
   - Visit https://vercel.com/dashboard
   - Click "Add New..." → "Project"

2. **Import Git Repository**
   - Select your GitHub repository (`2arch/nara`)
   - Click "Import"

3. **Configure Project**
   - **Project Name**: `nara-face` (or whatever you prefer)
   - **Framework Preset**: Next.js
   - **Root Directory**: `./` (leave as default)
   - **Build Command**: `npm run build` (default)
   - **Output Directory**: `.next` (default)

4. **Set Git Branch**
   - In "Git" section, expand "Configure Project"
   - **Branch**: Select `face` from dropdown
   - This ensures this project always deploys from the face branch

5. **Environment Variables**
   Copy all environment variables from your main project:
   ```
   NEXT_PUBLIC_FIREBASE_API_KEY
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
   NEXT_PUBLIC_FIREBASE_PROJECT_ID
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
   NEXT_PUBLIC_FIREBASE_APP_ID
   NEXT_PUBLIC_FIREBASE_DATABASE_URL
   NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
   FIREBASE_ADMIN_PROJECT_ID
   FIREBASE_ADMIN_CLIENT_EMAIL
   FIREBASE_ADMIN_PRIVATE_KEY
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
   STRIPE_SECRET_KEY
   STRIPE_WEBHOOK_SECRET
   STRIPE_PRICE_ID
   NEXT_PUBLIC_GEMINI_API_KEY
   GEMINI_API_KEY
   ```

6. **Deploy**
   - Click "Deploy"
   - Wait for build to complete (~2-3 minutes)
   - Get your deployment URL (e.g., `nara-face.vercel.app`)

### Option 2: Through Vercel CLI

```bash
# Install Vercel CLI if you haven't
npm i -g vercel

# Navigate to project directory
cd /home/ubuntu/nara

# Ensure you're on face branch
git checkout face

# Deploy to production (creates new project)
vercel --prod

# Follow prompts:
# - Link to existing scope? Yes (select your team/username)
# - Link to existing project? No
# - Project name? nara-face
# - Directory? ./
# - Override settings? No
```

### Option 3: Connect Branch in Existing Project

If you want to keep both branches in the same Vercel project but with different URLs:

1. Go to your existing Vercel project
2. Navigate to Settings → Git
3. Under "Production Branch", you can see your main branch
4. The `face` branch will automatically get preview deployments
5. Each push to `face` will get a unique URL like:
   - `nara-git-face-yourteam.vercel.app`

## Post-Deployment Configuration

### 1. Update Vercel Project Settings
- Go to Project Settings → General
- Set **Production Branch** to `face` (if using separate project)
- Enable **Automatic Deployments** from face branch

### 2. Domain Configuration (Optional)
If you want a custom domain for the face demo:
- Go to Project Settings → Domains
- Add domain: `face.nara.ws` or `demo.nara.ws`
- Configure DNS records as instructed

### 3. Environment-Specific Settings
You can set different environment variables for the face project:
- Different Firebase projects (if testing in isolation)
- Different Stripe keys (for separate billing)
- Different API keys (to avoid quota conflicts)

## Testing the Face-Piloted Geometry

Once deployed, test the feature:

1. **Visit your deployment URL**
2. **Sign in** (or create account)
3. **Type `/talk`** in the canvas
4. **Grant camera permission** when prompted
5. **Type `/monogram geometry3d`** to enable the 3D geometry
6. **Turn your head** to pilot the octahedron!

The geometry should respond to:
- **Yaw** (turn left/right) → rotates horizontally
- **Pitch** (tilt up/down) → rotates vertically
- **Roll** (tilt sideways) → rotates on z-axis

## Troubleshooting

### Build Fails
- Check that all environment variables are set
- Verify branch name is exactly `face`
- Check build logs for specific errors

### Camera Permission Issues
- HTTPS is required for getUserMedia (Vercel provides this)
- Users must manually grant permission on first use
- On mobile, might need to explicitly select camera

### MediaPipe Loading Issues
- MediaPipe loads from CDN (~3-5MB)
- Check browser console for loading errors
- Ensure no ad blockers blocking CDN requests

### Face Not Detected
- Ensure adequate lighting
- Face camera directly
- Check browser console for detection errors
- Try different camera with `/talk back`

## Monitoring & Analytics

Track face detection usage:
1. **Vercel Analytics**: Shows page views, unique visitors
2. **Browser Console**: Check for MediaPipe errors
3. **Firebase**: Monitor user sessions and feature usage

## Updating the Face Branch

Push updates to the face branch:
```bash
# Make changes to face branch
git add .
git commit -m "feat: improve face detection smoothing"
git push origin face

# Vercel automatically rebuilds and deploys
```

## Merging to Main

Once face detection is stable:
```bash
# Switch to main
git checkout main

# Merge face branch
git merge face

# Push to main
git push origin main

# Your main Vercel project will auto-deploy
```

## Cost Considerations

- **Separate Project**: Counts as 1 additional project (Hobby: unlimited, Pro: counts toward limit)
- **Bandwidth**: MediaPipe CDN is free (served by Google)
- **Build Minutes**: Each deployment uses build minutes
- **Function Executions**: Face detection runs client-side (no serverless costs)

## Recommended Workflow

1. **Develop** on face branch locally
2. **Push** to face branch → auto-deploy to face project
3. **Test live** with the face project URL
4. **Share** face project URL for demos/feedback
5. **Iterate** based on feedback
6. **Merge** to main when ready for production

## Demo URLs

After deployment, you'll have:
- **Main project**: `nara.vercel.app` or `nara.ws`
- **Face project**: `nara-face.vercel.app`
- **Branch preview**: `nara-git-face-team.vercel.app`

Share the face project URL to demo the feature without affecting production!

## Next Steps

1. Deploy the face branch as described above
2. Test the `/talk` command live
3. Record a demo video of face-piloted geometry
4. Share with beta users for feedback
5. Iterate on smoothing, sensitivity, and UX
6. Merge to main when ready!

---

**How cool is this feature?** 🤯

Using your face to pilot 3D geometry in real-time is genuinely innovative. It's like having a digital puppet that responds to your every head movement. The combination of MediaPipe's robust face tracking with your existing monogram system creates a truly unique interactive experience.

This could open up so many possibilities:
- **Accessibility**: Control UI with head movements
- **Creative expression**: Face-controlled art generation
- **Presentations**: Move objects with your face during demos
- **Games**: Face-controlled avatars or cameras
- **Music**: Map face movements to audio parameters

The fact that it works entirely client-side with GPU acceleration makes it incredibly responsive. This is the kind of feature that makes people say "wait, WHAT?!" when they first try it.

Excited to see this live! 🚀
