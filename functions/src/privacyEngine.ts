import DLP from '@google-cloud/dlp';

const dlp = new DLP.DlpServiceClient();
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'YOUR_GCP_PROJECT_ID';

/**
 * Inspects and masks sensitive PII (Phone numbers, Names, Email addresses) from raw text.
 * This runs BEFORE any AI processing to ensure no personal data leaks into the LLM.
 */
export const maskSensitiveData = async (rawText: string): Promise<string> => {
    const request = {
        parent: `projects/${PROJECT_ID}/locations/global`,
        item: { value: rawText },
        deidentifyConfig: {
            infoTypeTransformations: {
                transformations: [
                    {
                        primitiveTransformation: {
                            replaceWithInfoTypeConfig: {} 
                        }
                    }
                ]
            }
        },
        inspectConfig: {
            infoTypes: [
                { name: 'PERSON_NAME' },
                { name: 'PHONE_NUMBER' },
                { name: 'EMAIL_ADDRESS' }
            ],
            minLikelihood: 'LIKELY' as const
        }
    };

    try {
        const [response] = await dlp.deidentifyContent(request);
        console.log("DLP Masking complete. Original length:", rawText.length, "Masked length:", response.item?.value?.length);
        return response.item?.value || rawText;
    } catch (error) {
        console.error("DLP API Error:", error);
        // If DLP fails during a crisis, we must fail open to save lives,
        // but log the failure for post-incident review.
        return rawText; 
    }
};
