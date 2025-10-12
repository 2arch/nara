export class CanvasRecorder {
  private canvas: HTMLCanvasElement;
  private isRecording = false;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private frameRate: number;

  constructor(canvas: HTMLCanvasElement, frameRate: number = 60) {
    this.canvas = canvas;
    this.frameRate = frameRate;
  }

  start() {
    if (this.isRecording) {
      console.log('Already recording');
      return;
    }

    try {
      // Capture stream directly from canvas at specified framerate
      this.stream = this.canvas.captureStream(this.frameRate);

      // Try VP9 first (better quality), fallback to VP8
      let options: MediaRecorderOptions;
      if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
        options = {
          mimeType: 'video/webm;codecs=vp9',
          videoBitsPerSecond: 15000000 // 15 Mbps for excellent quality
        };
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
        options = {
          mimeType: 'video/webm;codecs=vp8',
          videoBitsPerSecond: 15000000
        };
      } else {
        options = {
          videoBitsPerSecond: 15000000
        };
      }

      this.mediaRecorder = new MediaRecorder(this.stream, options);
      this.recordedChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.start(100); // Collect data every 100ms
      this.isRecording = true;

      console.log(`🔴 Recording started (${this.frameRate}fps, ${(options.videoBitsPerSecond! / 1000000).toFixed(0)}Mbps, ${options.mimeType || 'default codec'})`);
    } catch (error) {
      console.error('Failed to start recording:', error);
      this.isRecording = false;
    }
  }

  captureFrame() {
    // No-op: MediaRecorder captures frames automatically from the stream
    // We keep this method for API compatibility
  }

  async stop(): Promise<void> {
    if (!this.isRecording || !this.mediaRecorder) {
      console.log('Not currently recording');
      return;
    }

    return new Promise((resolve) => {
      this.mediaRecorder!.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nara-recording-${Date.now()}.webm`;
        a.click();

        // Cleanup
        this.recordedChunks = [];
        this.isRecording = false;

        if (this.stream) {
          this.stream.getTracks().forEach(track => track.stop());
          this.stream = null;
        }

        console.log('✅ High-quality WebM video downloaded!');
        resolve();
      };

      this.mediaRecorder!.stop();
      console.log('🛑 Recording stopped. Processing video...');
    });
  }

  toggle() {
    if (this.isRecording) {
      return this.stop();
    } else {
      this.start();
    }
  }

  getIsRecording(): boolean {
    return this.isRecording;
  }

  getFrameCount(): number {
    return this.recordedFrames.length;
  }
}
