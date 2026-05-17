import { describe, expect, it } from "vitest";
import { GoogleGenerativeAI } from "@google/generative-ai";

describe("Gemini API Integration", () => {
  it("should have GEMINI_API_KEY configured", () => {
    const apiKey = process.env.GEMINI_API_KEY;
    expect(apiKey).toBeDefined();
    expect(apiKey).toBeTruthy();
    expect(apiKey?.length).toBeGreaterThan(0);
  });

  it("should be able to instantiate GoogleGenerativeAI with the API key", () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not set");
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    expect(genAI).toBeDefined();
    
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    expect(model).toBeDefined();
  });
});

