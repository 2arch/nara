import { Point } from './world.engine';

export interface FrameData {
    timestamp: number;
    face: {
        rotX: number;
        rotY: number;
        rotZ: number;
        mouthOpen?: number;
        leftEyeBlink?: number;
        rightEyeBlink?: number;
        isTracked?: boolean;
    } | undefined;
    cursor: Point;
    viewOffset: Point;
    zoomLevel: number;
    contentChange?: ContentChange; // Optional: character placed at this frame
}

export interface ContentChange {
    timestamp: number;
    key: string;
    value: any;
}

export interface RecordingSession {
    name: string;
    startTime: number;
    duration: number;
    frames: FrameData[];
    contentChanges: ContentChange[];
}

export class DataRecorder {
    isRecording: boolean = false;
    isPlaying: boolean = false;
    currentRecording: RecordingSession | null = null;
    private frames: FrameData[] = [];
    private contentChanges: ContentChange[] = []; // Kept for backward compatibility with old recordings
    private startTime: number = 0;
    private playbackStart: number = 0;
    private playbackIndex: number = 0;

    start() {
        this.isRecording = true;
        this.frames = [];
        this.contentChanges = [];
        this.startTime = Date.now();
        console.log('Recording started');
    }

    stop(): RecordingSession | null {
        if (!this.isRecording) return null;
        this.isRecording = false;
        const duration = Date.now() - this.startTime;

        this.currentRecording = {
            name: `recording_${this.startTime}`,
            startTime: this.startTime,
            duration,
            frames: this.frames,
            contentChanges: this.contentChanges
        };

        console.log(`Recording stopped. Captured ${this.frames.length} frames and ${this.contentChanges.length} content changes.`);
        console.log('Content changes:', this.contentChanges);
        console.log('First 5 content changes:', this.contentChanges.slice(0, 5));
        console.log('Frame timestamps range:', this.frames.length > 0 ? `${this.frames[0].timestamp}ms to ${this.frames[this.frames.length-1].timestamp}ms` : 'no frames');
        console.log('Content change timestamps range:', this.contentChanges.length > 0 ? `${this.contentChanges[0].timestamp}ms to ${this.contentChanges[this.contentChanges.length-1].timestamp}ms` : 'no changes');
        return this.currentRecording;
    }

    capture(engine: any) {
        if (!this.isRecording) return;

        const frame: FrameData = {
            timestamp: Date.now() - this.startTime,
            face: engine.faceOrientation ? { ...engine.faceOrientation } : undefined,
            cursor: { ...engine.cursorPos },
            viewOffset: { ...engine.viewOffset },
            zoomLevel: engine.zoomLevel
        };

        this.frames.push(frame);
    }

    recordContentChange(key: string, value: any) {
        if (!this.isRecording) return;

        const change: ContentChange = {
            timestamp: Date.now() - this.startTime,
            key,
            value
        };

        // Keep for backward compatibility with old recordings
        this.contentChanges.push(change);

        // Attach to the most recent frame to sync content with cursor position
        if (this.frames.length > 0) {
            const lastFrame = this.frames[this.frames.length - 1];
            // Only attach if this frame doesn't already have a content change
            // and the timestamp is close (within last 100ms)
            if (!lastFrame.contentChange && (change.timestamp - lastFrame.timestamp) < 100) {
                lastFrame.contentChange = change;
                console.log(`[Recording] Attached content change to frame at cursor (${lastFrame.cursor.x}, ${lastFrame.cursor.y})`);
            }
        }
    }

    loadRecording(session: RecordingSession) {
        this.currentRecording = session;
        this.playbackIndex = 0;
    }

    startPlayback() {
        if (!this.currentRecording) {
            console.log('Cannot start playback: no currentRecording');
            return;
        }
        this.isPlaying = true;
        this.playbackStart = Date.now();
        this.playbackIndex = 0;
        console.log('Playback started');
        console.log(`Recording has ${this.currentRecording.frames.length} frames`);
        const framesWithContent = this.currentRecording.frames.filter(f => f.contentChange);
        console.log(`${framesWithContent.length} frames have content changes`);
    }

    stopPlayback() {
        this.isPlaying = false;
        console.log('Playback stopped');
    }

    getPlaybackFrame(): FrameData | null {
        if (!this.isPlaying || !this.currentRecording) return null;

        const elapsed = Date.now() - this.playbackStart;

        if (elapsed > this.currentRecording.duration) {
            this.stopPlayback();
            return null;
        }

        // Advance index to find the latest frame that matches current time
        while(this.playbackIndex < this.currentRecording.frames.length - 1 &&
              this.currentRecording.frames[this.playbackIndex + 1].timestamp <= elapsed) {
            this.playbackIndex++;
        }

        return this.currentRecording.frames[this.playbackIndex];
    }

    
    // Export recording as JSON string
    exportRecording(): string {
        return JSON.stringify(this.currentRecording);
    }
    
    // Import recording from JSON string
    importRecording(json: string): boolean {
        try {
            const session = JSON.parse(json) as RecordingSession;
            if (session.frames && Array.isArray(session.frames)) {
                // Ensure backward compatibility with old recordings without contentChanges
                if (!session.contentChanges) {
                    session.contentChanges = [];
                }
                this.loadRecording(session);
                return true;
            }
            return false;
        } catch (e) {
            console.error('Failed to import recording', e);
            return false;
        }
    }
}
