import { useState, useEffect, useRef, useCallback } from 'react';
import { FilesetResolver, FaceLandmarker, FaceLandmarkerResult } from '@mediapipe/tasks-vision';

// Face orientation data extracted from landmarks
export interface FaceOrientation {
    pitch: number; // Head tilt up/down (-π to π)
    yaw: number;   // Head turn left/right (-π to π)
    roll: number;  // Head tilt side-to-side (-π to π)
    confidence: number; // Detection confidence (0-1)
}

export interface FaceExpressionData {
    orientation: FaceOrientation;
    blendshapes?: Map<string, number>; // Facial expressions (smile, eyebrow, etc.)
    landmarks?: any[]; // Raw landmark data
    timestamp: number;
}

interface UseFaceDetectionProps {
    enabled: boolean;
    videoStream?: MediaStream | null;
    onFaceDetected?: (data: FaceExpressionData) => void;
}

/**
 * MediaPipe Face Detection Hook
 * Processes video stream to extract face orientation and expressions
 * Designed to pilot 3D geometry monograms with head movements
 */
export const useFaceDetection = ({
    enabled,
    videoStream,
    onFaceDetected
}: UseFaceDetectionProps) => {
    const [faceData, setFaceData] = useState<FaceExpressionData | null>(null);
    const [isReady, setIsReady] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // MediaPipe instances
    const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
    const videoElementRef = useRef<HTMLVideoElement | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const lastDetectionTimeRef = useRef<number>(0);

    // Initialize MediaPipe Face Landmarker
    useEffect(() => {
        if (!enabled) return;

        let mounted = true;

        const initializeMediaPipe = async () => {
            try {
                console.log('[MediaPipe] Starting initialization...');

                // Load MediaPipe vision tasks
                console.log('[MediaPipe] Loading vision tasks from CDN...');
                const vision = await FilesetResolver.forVisionTasks(
                    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
                );
                console.log('[MediaPipe] Vision tasks loaded ✓');

                // Create Face Landmarker with optimized settings
                console.log('[MediaPipe] Creating Face Landmarker...');
                const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                        delegate: 'GPU' // Use GPU acceleration
                    },
                    runningMode: 'VIDEO',
                    numFaces: 1, // Track single face for performance
                    minFaceDetectionConfidence: 0.5,
                    minFacePresenceConfidence: 0.5,
                    minTrackingConfidence: 0.5,
                    outputFaceBlendshapes: true, // Enable expression detection
                    outputFacialTransformationMatrixes: true // Enable transformation matrices
                });
                console.log('[MediaPipe] Face Landmarker ready ✓');

                if (mounted) {
                    faceLandmarkerRef.current = faceLandmarker;
                    setIsReady(true);
                    setError(null);
                    console.log('[MediaPipe] Initialization complete! Ready for face detection.');
                }
            } catch (err) {
                console.error('[MediaPipe] FAILED to initialize:', err);
                if (mounted) {
                    setError('Failed to load face detection. Check console for details.');
                }
            }
        };

        initializeMediaPipe();

        return () => {
            mounted = false;
            // Cleanup will happen in separate effect
        };
    }, [enabled]);

    // Setup video element from stream
    useEffect(() => {
        if (!videoStream || !enabled) {
            // Clean up video element if stream is removed
            if (videoElementRef.current) {
                console.log('[Face Video] Cleaning up video element');
                videoElementRef.current.srcObject = null;
                videoElementRef.current = null;
            }
            return;
        }

        console.log('[Face Video] Setting up video element for face detection');

        // Create video element for MediaPipe processing
        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.srcObject = videoStream;

        videoElementRef.current = video;

        // Wait for video to be ready
        video.addEventListener('loadeddata', () => {
            console.log('[Face Video] Video ready:', video.videoWidth, 'x', video.videoHeight);
            video.play().then(() => {
                console.log('[Face Video] Video playing ✓');
            }).catch(err => {
                console.error('[Face Video] Failed to play:', err);
                setError('Failed to start video stream');
            });
        });

        return () => {
            if (video.srcObject) {
                video.srcObject = null;
            }
        };
    }, [videoStream, enabled]);

    /**
     * Calculate face orientation from landmarks
     * Uses key facial landmarks to estimate head rotation
     */
    const calculateOrientation = useCallback((result: FaceLandmarkerResult): FaceOrientation => {
        if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
            return { pitch: 0, yaw: 0, roll: 0, confidence: 0 };
        }

        const landmarks = result.faceLandmarks[0];

        // Key landmark indices (MediaPipe Face Mesh)
        // Nose tip: 1, Chin: 152, Left eye: 33, Right eye: 263
        // Left mouth: 61, Right mouth: 291
        const noseTip = landmarks[1];
        const chin = landmarks[152];
        const leftEye = landmarks[33];
        const rightEye = landmarks[263];
        const leftMouth = landmarks[61];
        const rightMouth = landmarks[291];
        const forehead = landmarks[10];

        // Calculate yaw (left/right turn) using eye positions
        const eyeVector = {
            x: rightEye.x - leftEye.x,
            y: rightEye.y - leftEye.y,
            z: rightEye.z - leftEye.z
        };
        const yaw = Math.atan2(eyeVector.z, eyeVector.x);

        // Calculate pitch (up/down tilt) using nose-to-chin vector
        const verticalVector = {
            x: chin.x - noseTip.x,
            y: chin.y - noseTip.y,
            z: chin.z - noseTip.z
        };
        const pitch = Math.atan2(verticalVector.z, verticalVector.y);

        // Calculate roll (side tilt) using eye alignment
        const roll = Math.atan2(eyeVector.y, eyeVector.x);

        // Get confidence from detection
        const confidence = result.faceLandmarks.length > 0 ? 1.0 : 0.0;

        return {
            pitch: pitch * 2, // Amplify for more responsive control
            yaw: yaw * 2,
            roll: roll,
            confidence
        };
    }, []);

    /**
     * Process video frame with MediaPipe
     * Extracts face orientation and expressions
     */
    const processFrame = useCallback(() => {
        if (!enabled || !isReady || !faceLandmarkerRef.current || !videoElementRef.current) {
            return;
        }

        const video = videoElementRef.current;

        // Skip if video not ready
        if (video.readyState < 2) {
            animationFrameRef.current = requestAnimationFrame(processFrame);
            return;
        }

        // Throttle detection to 30fps for performance
        const now = performance.now();
        if (now - lastDetectionTimeRef.current < 33) {
            animationFrameRef.current = requestAnimationFrame(processFrame);
            return;
        }
        lastDetectionTimeRef.current = now;

        try {
            // Run face detection
            const result = faceLandmarkerRef.current.detectForVideo(video, now);

            if (result.faceLandmarks && result.faceLandmarks.length > 0) {
                // Calculate orientation from landmarks
                const orientation = calculateOrientation(result);

                // Extract blendshapes if available
                const blendshapes = result.faceBlendshapes?.[0]?.categories
                    ? new Map(
                        result.faceBlendshapes[0].categories.map(cat => [
                            cat.categoryName,
                            cat.score
                        ])
                    )
                    : undefined;

                const faceData: FaceExpressionData = {
                    orientation,
                    blendshapes,
                    landmarks: result.faceLandmarks[0],
                    timestamp: now
                };

                setFaceData(faceData);

                // Notify parent component
                if (onFaceDetected) {
                    onFaceDetected(faceData);
                }
            } else {
                // No face detected
                setFaceData(null);
            }
        } catch (err) {
            console.error('Face detection error:', err);
        }

        // Continue processing
        animationFrameRef.current = requestAnimationFrame(processFrame);
    }, [enabled, isReady, calculateOrientation, onFaceDetected]);

    // Start/stop detection loop
    useEffect(() => {
        if (enabled && isReady && videoElementRef.current) {
            console.log('[Face Detection] Starting detection loop...');
            // Start detection loop
            animationFrameRef.current = requestAnimationFrame(processFrame);
        } else {
            console.log('[Face Detection] Not starting:', { enabled, isReady, hasVideo: !!videoElementRef.current });
        }

        return () => {
            if (animationFrameRef.current) {
                console.log('[Face Detection] Stopping detection loop');
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        };
    }, [enabled, isReady, processFrame]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (faceLandmarkerRef.current) {
                faceLandmarkerRef.current.close();
                faceLandmarkerRef.current = null;
            }
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, []);

    return {
        faceData,
        isReady,
        error,
        hasDetection: faceData !== null
    };
};

/**
 * Smooth face orientation with low-pass filter
 * Reduces jitter and provides stable rotation values
 */
export const useSmoothFaceOrientation = (
    faceData: FaceExpressionData | null,
    smoothingFactor: number = 0.3
) => {
    const [smoothOrientation, setSmoothOrientation] = useState<FaceOrientation>({
        pitch: 0,
        yaw: 0,
        roll: 0,
        confidence: 0
    });

    const prevOrientationRef = useRef<FaceOrientation>(smoothOrientation);

    useEffect(() => {
        if (!faceData) return;

        const newOrientation = faceData.orientation;
        const prev = prevOrientationRef.current;

        // Apply exponential smoothing (low-pass filter)
        const smoothed: FaceOrientation = {
            pitch: prev.pitch + (newOrientation.pitch - prev.pitch) * smoothingFactor,
            yaw: prev.yaw + (newOrientation.yaw - prev.yaw) * smoothingFactor,
            roll: prev.roll + (newOrientation.roll - prev.roll) * smoothingFactor,
            confidence: newOrientation.confidence
        };

        prevOrientationRef.current = smoothed;
        setSmoothOrientation(smoothed);
    }, [faceData, smoothingFactor]);

    return smoothOrientation;
};

/**
 * Convert face orientation to monogram rotation angles
 * Maps face rotation to 3D geometry rotation for natural control
 */
export const faceOrientationToRotation = (
    orientation: FaceOrientation,
    invertYaw: boolean = false,
    invertPitch: boolean = false,
    invertRoll: boolean = false
): { rotX: number; rotY: number; rotZ: number } => {
    return {
        rotX: invertPitch ? -orientation.pitch : orientation.pitch,
        rotY: invertYaw ? -orientation.yaw : orientation.yaw,
        rotZ: invertRoll ? -orientation.roll : orientation.roll
    };
};
