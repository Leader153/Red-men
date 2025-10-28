import React, { useState, useRef, useEffect, useCallback } from 'react';
import { analyzeFrame, textToSpeech } from './services/geminiService';
import { APP_TITLE, APP_DESCRIPTION, DEFAULT_ANALYSIS_INTERVAL_MS } from './constants';
import { CameraIcon, CameraOffIcon, ProcessingIcon } from './components/IconComponents';

const COOLDOWN_DURATION_MS = 20000; // 20 seconds

const Loader: React.FC = () => (
  <div className="flex items-center justify-center space-x-2">
    <ProcessingIcon className="w-6 h-6 text-sky-400 animate-spin" />
    <span className="text-lg text-gray-300">מנתח פריים...</span>
  </div>
);

// Audio helper functions
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}


const App: React.FC = () => {
  const [isCameraOn, setIsCameraOn] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isOnCooldown, setIsOnCooldown] = useState<boolean>(false);
  const [analysisResult, setAnalysisResult] = useState<string>('הפעל מצלמה כדי להתחיל.');
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [analysisInterval, setAnalysisInterval] = useState<number>(DEFAULT_ANALYSIS_INTERVAL_MS);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analysisIntervalRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const stopCamera = useCallback(() => {
    if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
        analysisIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setStream(null);
    setIsCameraOn(false);
    setAnalysisResult('הפעל מצלמה כדי להתחיל.');
  }, []);
  
  const playAudio = useCallback(async (base64Audio: string) => {
    if (!audioContextRef.current) {
      console.warn("AudioContext not initialized.");
      return;
    }
    try {
      const audioBuffer = await decodeAudioData(
        decode(base64Audio),
        audioContextRef.current,
        24000,
        1
      );
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.start();
      await new Promise(resolve => source.onended = resolve);
    } catch (e) {
      console.error("Failed to play audio:", e);
      setError("שגיאה בהשמעת הקול.");
    }
  }, []);

  const runAnalysis = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    if (isLoading || isSpeaking || isOnCooldown) return; // Prevent overlapping runs

    setIsLoading(true);
    setError(null);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (context) {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64ImageData = canvas.toDataURL('image/jpeg').split(',')[1];
      
      try {
        const result = await analyzeFrame(base64ImageData);
        
        if (result && result.toUpperCase() !== 'NOPERS') {
            setAnalysisResult(result);
            setIsLoading(false);
            setIsSpeaking(true);
            setIsOnCooldown(true);
            try {
                const audioData = await textToSpeech(result);
                await playAudio(audioData);
            } catch (ttsError) {
                console.error(ttsError);
            } finally {
                setIsSpeaking(false);
                setAnalysisResult(`זוהה אדם. הניתוח יושהה ל-${COOLDOWN_DURATION_MS / 1000} שניות.`);
                setTimeout(() => {
                    setIsOnCooldown(false);
                    setAnalysisResult('מוכן לניתוח.');
                }, COOLDOWN_DURATION_MS);
            }
        } else {
            setIsLoading(false);
            if (!isOnCooldown) {
                setAnalysisResult('לא זוהה אדם.');
            }
        }
      } catch (err) {
        setIsLoading(false);
        console.error(err);
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(`הניתוח נכשל: ${errorMessage}`);
      }
    } else {
        setIsLoading(false);
    }
  }, [isLoading, isSpeaking, isOnCooldown, playAudio]);

  const handleToggleCamera = useCallback(async () => {
    if (isCameraOn) {
      stopCamera();
    } else {
      try {
        setError(null);
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
              sampleRate: 24000,
            });
        }
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: 'user' },
          audio: false,
        });
        streamRef.current = mediaStream;
        setStream(mediaStream);
        setIsCameraOn(true);
        setAnalysisResult("מצלמה הופעלה. ממתין לזיהוי...");
      } catch (err) {
        console.error("Error accessing camera:", err);
        setError("לא ניתן לגשת למצלמה. אנא בדוק הרשאות ונסה שוב.");
        setIsCameraOn(false);
      }
    }
  }, [isCameraOn, stopCamera]);
  
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => console.error("Video play failed:", e));
    }
  }, [stream]);

  useEffect(() => {
    if (isCameraOn) {
        analysisIntervalRef.current = window.setInterval(runAnalysis, analysisInterval);
    } else {
        if(analysisIntervalRef.current) {
            clearInterval(analysisIntervalRef.current);
            analysisIntervalRef.current = null;
        }
    }
    return () => {
        if (analysisIntervalRef.current) {
            clearInterval(analysisIntervalRef.current);
        }
    };
  }, [isCameraOn, runAnalysis, analysisInterval]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-4 md:p-8 font-sans">
      <header className="w-full max-w-5xl text-center mb-6">
        <h1 className="text-4xl md:text-5xl font-bold text-sky-400">{APP_TITLE}</h1>
        <p className="text-lg md:text-xl text-gray-400 mt-2">{APP_DESCRIPTION}</p>
      </header>

      <main className="w-full max-w-5xl flex flex-col items-center">
        <div className="w-full aspect-video bg-black rounded-lg shadow-2xl shadow-sky-900/50 overflow-hidden border-2 border-gray-700 relative flex items-center justify-center">
          <video ref={videoRef} className={`w-full h-full object-cover ${!isCameraOn && 'hidden'}`} playsInline muted />
          {!isCameraOn && (
            <div className="text-center text-gray-400">
              <CameraOffIcon className="w-24 h-24 mx-auto mb-4" />
              <p className="text-xl">מצלמה כבויה</p>
            </div>
          )}
           <canvas ref={canvasRef} className="hidden" />
        </div>
        
        {error && (
          <div className="mt-4 w-full bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-md text-center">
            {error}
          </div>
        )}
        
        <div className="w-full mt-6 flex flex-col gap-4">
            <div className="w-full bg-gray-800/50 p-4 rounded-lg border border-gray-700 flex flex-col md:flex-row-reverse items-center justify-between gap-4">
              <div className="flex-grow h-16 flex items-center justify-center md:justify-start">
                {isLoading ? <Loader /> : <p className="text-2xl font-mono text-green-300 text-center md:text-right">{analysisResult}</p>}
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={handleToggleCamera}
                  className="px-5 py-3 rounded-lg font-semibold text-white transition-all duration-300 flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 bg-gray-700 hover:bg-gray-600 focus:ring-gray-500"
                  aria-label={isCameraOn ? 'כיבוי מצלמה' : 'הפעלת מצלמה'}
                >
                  {isCameraOn ? <CameraOffIcon className="w-6 h-6" /> : <CameraIcon className="w-6 h-6" />}
                  <span>{isCameraOn ? 'כבה מצלמה' : 'הפעל מצלמה'}</span>
                </button>
              </div>
            </div>

            <div className="w-full bg-gray-800/50 p-4 rounded-lg border border-gray-700 flex flex-col items-center gap-2">
                <label htmlFor="interval-slider" className="block text-center text-sm text-gray-400" id="interval-label">
                מרווח ניתוח: <span className="font-bold text-sky-400">{analysisInterval / 1000}</span> שניות
                </label>
                <input
                    id="interval-slider"
                    type="range"
                    min="2000"
                    max="20000"
                    step="1000"
                    value={analysisInterval}
                    onChange={(e) => setAnalysisInterval(Number(e.target.value))}
                    disabled={!isCameraOn}
                    className="w-full max-w-md h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-0 focus:ring-sky-500"
                    aria-labelledby="interval-label"
                />
            </div>
        </div>
      </main>
    </div>
  );
};

export default App;
