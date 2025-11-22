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
    private contentChanges: ContentChange[] = [];
    private startTime: number = 0;
    private playbackStart: number = 0;
    private playbackIndex: number = 0;
    private contentChangeIndex: number = 0;

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

        this.contentChanges.push(change);
    }

    loadRecording(session: RecordingSession) {
        this.currentRecording = session;
        this.playbackIndex = 0;
        this.contentChangeIndex = 0;
    }

    startPlayback() {
        if (!this.currentRecording) return;
        this.isPlaying = true;
        this.playbackStart = Date.now();
        this.playbackIndex = 0;
        this.contentChangeIndex = 0;
        console.log('Playback started');
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

    getPlaybackContentChanges(): ContentChange[] {
        if (!this.isPlaying || !this.currentRecording) return [];

        const elapsed = Date.now() - this.playbackStart;
        const changes: ContentChange[] = [];

        // Apply only one content change per frame for character-by-character playback
        if (this.contentChangeIndex < this.currentRecording.contentChanges.length &&
            this.currentRecording.contentChanges[this.contentChangeIndex].timestamp <= elapsed) {
            changes.push(this.currentRecording.contentChanges[this.contentChangeIndex]);
            this.contentChangeIndex++;
        }

        return changes;
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
