const { VertexAI } = require('@google-cloud/vertexai');

// Initialize Vertex AI
// Ensure your local emulator has GCP credentials or provide them via env variables in production
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'YOUR_GCP_PROJECT_ID'; 
const LOCATION = 'us-central1'; 

const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });

// Using flash for low latency semantic triage. 
// Enforcing application/json to guarantee our pipeline does not break.
const generativeModel = vertexAI.preview.getGenerativeModel({
    model: 'gemini-1.5-flash', 
    generationConfig: {
        temperature: 0.2, 
        responseMimeType: "application/json", 
    }
});

exports.analyzeReportVertex = async (textPayload) => {
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

    const request = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
    };
    
    try {
        const result = await generativeModel.generateContent(request);
        const responseText = result.response.candidates[0].content.parts[0].text;
        return JSON.parse(responseText);
    } catch (error) {
        console.error("Vertex AI Orchestration Error:", error);
        // Fallback safety payload
        return {
            credibility: 0.5,
            uncertainty: 0.9,
            risk_flag: "processing error",
            reasoning: "AI fallback triggered due to timeout or error."
        };
    }
};
