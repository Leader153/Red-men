import { GoogleGenAI, Modality } from "@google/genai";
import { SYSTEM_INSTRUCTION, USER_PROMPT } from '../constants';

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable is not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function analyzeFrame(base64ImageData: string): Promise<string> {
  try {
    const imagePart = {
      inlineData: {
        mimeType: 'image/jpeg',
        data: base64ImageData,
      },
    };

    const textPart = {
      text: USER_PROMPT,
    };

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [textPart, imagePart] },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.2, // Lower temperature for more deterministic output
      },
    });

    return response.text.trim();
  } catch (error) {
    console.error("Error analyzing frame:", error);
    if (error instanceof Error) {
      // Re-throw the error to be caught by the calling function
      throw new Error(error.message);
    }
    throw new Error("An unknown error occurred during analysis.");
  }
}

export async function textToSpeech(text: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' }, // A pleasant female voice
          },
        },
      },
    });
    
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      throw new Error("No audio data received from TTS API.");
    }
    
    return base64Audio;
  } catch (error) {
    console.error("Error generating speech:", error);
    if (error instanceof Error) {
      throw new Error(`TTS Error: ${error.message}`);
    }
    throw new Error("An unknown error occurred during text-to-speech conversion.");
  }
}
