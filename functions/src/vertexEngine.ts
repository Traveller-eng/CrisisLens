import { VertexAI } from '@google-cloud/vertexai';

export interface VertexAnalysis {
    credibility: number;
    uncertainty: number;
    risk_flag: string;
    reasoning: string;
}

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'YOUR_GCP_PROJECT_ID'; 
const LOCATION = 'us-central1'; 

const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });

const generativeModel = vertexAI.preview.getGenerativeModel({
    model: 'gemini-1.5-flash', 
    generationConfig: {
        temperature: 0.2, 
        responseMimeType: "application/json", 
    }
});

const TIMEOUT_MS = 4000;

const TIMEOUT_FALLBACK: VertexAnalysis = {
    credibility: 0.5,
    uncertainty: 1.0,
    risk_flag: "AI Timeout - Manual Review Required",
    reasoning: "System overloaded, defaulting to human review."
};

export const analyzeReportVertex = async (textPayload: string): Promise<VertexAnalysis> => {
    const prompt = `
    You are the semantic reasoning engine for an emergency response system (CrisisLens).
    Analyze the following emergency report for contradictions, trust, and urgency.
    
    Output strictly as JSON matching this schema:
    {
      "credibility": <float between 0.0 and 1.0>,
      "uncertainty": <float between 0.0 and 1.0>,
      "risk_flag": <string: e.g., "high contradiction", "verified panic", "clear report">,
      "reasoning": <string: a one-sentence explanation of your score>
    }
    
    Report: "${textPayload}"
    `;

    const vertexCall = async (): Promise<VertexAnalysis> => {
        const request = { contents: [{ role: 'user' as const, parts: [{ text: prompt }] }] };
        const result = await generativeModel.generateContent(request);
        
        if (!result.response.candidates || result.response.candidates.length === 0) {
            throw new Error("No candidates returned from Vertex AI");
        }
        
        const responseText = result.response.candidates[0].content.parts[0].text;
        return JSON.parse(responseText as string) as VertexAnalysis;
    };

    const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Vertex AI timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
    );

    try {
        return await Promise.race([vertexCall(), timeout]);
    } catch (error) {
        console.error("Vertex AI Error:", error);
        return TIMEOUT_FALLBACK;
    }
};
