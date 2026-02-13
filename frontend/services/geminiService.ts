import { GoogleGenAI, Type, Schema } from "@google/genai";
import { DocumentFile, ExtractionCell, Column, ExtractionResult } from "../types";
import { logRuntimeEvent } from "./runtimeLogger";

// Initialize Gemini Client
const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
if (!apiKey) {
  console.error("VITE_GEMINI_API_KEY is not set in environment variables");
}
const ai = new GoogleGenAI({ apiKey: apiKey || "" });

// Helper for delay
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Generic retry wrapper
async function withRetry<T>(operation: () => Promise<T>, retries = 5, initialDelay = 1000): Promise<T> {
  let currentTry = 0;
  while (true) {
    try {
      return await operation();
    } catch (error: any) {
      currentTry++;
      
      // Check for Rate Limit / Quota errors
      const isRateLimit = 
        error?.status === 429 || 
        error?.code === 429 ||
        error?.message?.includes('429') || 
        error?.message?.includes('RESOURCE_EXHAUSTED') ||
        error?.message?.includes('quota');

      if (isRateLimit && currentTry <= retries) {
        // Exponential backoff with jitter to prevent thundering herd
        const delay = initialDelay * Math.pow(2, currentTry - 1) + (Math.random() * 1000);
        console.warn(`Gemini API Rate Limit hit. Retrying attempt ${currentTry} in ${delay.toFixed(0)}ms...`);
        logRuntimeEvent({
          event: 'gemini_rate_limit_retry',
          level: 'warning',
          stage: 'analysis',
          message: 'Gemini quota/rate limit encountered',
          metadata: {
            retry_attempt: currentTry,
            max_retries: retries,
            delay_ms: Math.round(delay),
          },
        });
        await wait(delay);
        continue;
      }
      
      // If not a rate limit or retries exhausted, throw
      if (isRateLimit && currentTry > retries) {
        logRuntimeEvent({
          event: 'gemini_rate_limit_exhausted',
          level: 'error',
          stage: 'analysis',
          message: 'Retries exhausted after repeated Gemini rate limits',
          metadata: {
            retry_attempts: currentTry,
            max_retries: retries,
          },
        });
      }
      throw error;
    }
  }
}

// Schema for Extraction
const extractionSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    value: {
      type: Type.STRING,
      description: "The extracted answer. Keep it concise.",
    },
    confidence: {
      type: Type.STRING,
      enum: ["High", "Medium", "Low"],
      description: "Confidence level of the extraction.",
    },
    quote: {
      type: Type.STRING,
      description: "Verbatim text from the document supporting the answer. Must be exact substring.",
    },
    page: {
      type: Type.INTEGER,
      description: "The page number where the information was found (approximate if not explicit).",
    },
    reasoning: {
      type: Type.STRING,
      description: "A short explanation of why this value was selected.",
    },
  },
  required: ["value", "confidence", "quote", "reasoning"],
};

export const extractColumnData = async (
  doc: DocumentFile,
  column: Column,
  modelId: string
): Promise<ExtractionCell> => {
  return withRetry(async () => {
    try {
      const parts = [];
      
      // We assume doc.content is now ALWAYS text/markdown because we converted it locally on upload.
      // Decode Base64 to get the text
      let docText = "";
      try {
          docText = decodeURIComponent(escape(atob(doc.content)));
      } catch (e) {
          // Fallback
          docText = atob(doc.content);
      }

      parts.push({
        text: `DOCUMENT CONTENT:\n${docText}`,
      });
  
      // Format instruction based on column type
      let formatInstruction = "";
      switch (column.type) {
        case 'date':
            formatInstruction = "Format the date as YYYY-MM-DD.";
            break;
        case 'boolean':
            formatInstruction = "Return 'true' or 'false' as the value string.";
            break;
        case 'number':
            formatInstruction = "Return a clean number string, removing currency symbols if needed.";
            break;
        case 'list':
            formatInstruction = "Return the items as a comma-separated string.";
            break;
        default:
            formatInstruction = "Keep the text concise.";
      }

      const prompt = `Task: Extract specific information from the provided document.
      
      Column Name: "${column.name}"
      Extraction Instruction: ${column.prompt}
      
      Format Requirements:
      - ${formatInstruction}
      - Provide a confidence score (High/Medium/Low).
      - Include the exact quote from the text where the answer is found.
      - Provide a brief reasoning.
      `;

      parts.push({ text: prompt });

      const response = await ai.models.generateContent({
        model: modelId,
        contents: {
            role: 'user',
            parts: parts
        },
        config: {
            responseMimeType: 'application/json',
            responseSchema: extractionSchema,
            systemInstruction: "You are a precise data extraction agent. You must extract data exactly as requested."
        }
      });

      const responseText = response.text;
      if (!responseText) {
          throw new Error("Empty response from model");
      }

      const json = JSON.parse(responseText);

      return {
        value: String(json.value || ""),
        confidence: (json.confidence as any) || "Low",
        quote: json.quote || "",
        page: json.page || 1,
        reasoning: json.reasoning || "",
        status: 'needs_review'
      };

    } catch (error) {
      console.error("Extraction error:", error);
      throw error;
    }
  });
};

export const generatePromptHelper = async (
    name: string,
    type: string,
    currentPrompt: string | undefined,
    modelId: string
): Promise<string> => {
    const prompt = `I need to configure a Large Language Model to extract a specific data field from business documents.
    
    Field Name: "${name}"
    Field Type: "${type}"
    ${currentPrompt ? `Draft Prompt: "${currentPrompt}"` : ""}
    
    Please write a clear, effective prompt that I can send to the LLM to get the best extraction results for this field. 
    The prompt should describe what to look for and how to handle edge cases if applicable.
    Return ONLY the prompt text, no conversational filler.`;

    try {
        const response = await ai.models.generateContent({
            model: modelId,
            contents: prompt
        });
        return response.text?.trim() || "";
    } catch (error) {
        console.error("Prompt generation error:", error);
        return currentPrompt || `Extract the ${name} from the document.`;
    }
};

export const analyzeDataWithChat = async (
    message: string,
    context: { documents: DocumentFile[], columns: Column[], results: ExtractionResult },
    history: any[],
    modelId: string
): Promise<string> => {
    let dataContext = "CURRENT EXTRACTION DATA:\n";
    dataContext += `Documents: ${context.documents.map(d => d.name).join(", ")}\n`;
    dataContext += `Columns: ${context.columns.map(c => c.name).join(", ")}\n\n`;
    dataContext += "DATA TABLE (CSV Format):\n";
    
    const headers = ["Document Name", ...context.columns.map(c => c.name)].join(",");
    dataContext += headers + "\n";
    
    context.documents.forEach(doc => {
        const row = [doc.name];
        context.columns.forEach(col => {
            const cell = context.results[doc.id]?.[col.id];
            const val = cell ? cell.value.replace(/,/g, ' ') : "N/A";
            row.push(val);
        });
        dataContext += row.join(",") + "\n";
    });

    const systemInstruction = `You are an intelligent data analyst assistant. 
    You have access to a dataset extracted from documents (provided in context).
    
    User Query: ${message}
    
    ${dataContext}
    
    Instructions:
    1. Answer the user's question based strictly on the provided data table.
    2. If comparing documents, mention them by name.
    3. If the data is missing or N/A, state that clearly.
    4. Keep answers professional and concise.`;

    try {
        const chat = ai.chats.create({
            model: modelId,
            config: {
                systemInstruction: systemInstruction
            },
            history: history
        });

        const response = await chat.sendMessage({ message: message });
        return response.text || "No response generated.";
    } catch (error) {
        console.error("Chat analysis error:", error);
        return "I apologize, but I encountered an error while analyzing the data. Please try again.";
    }
};
