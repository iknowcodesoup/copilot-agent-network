// "openai-generic" (not "openai") is BAML's documented provider for
// OpenAI-compatible local servers like LM Studio/Ollama. env.VAR
// interpolation keeps this pointed at whatever the app's LLM_BASE_URL/
// LLM_API_KEY/LLM_MODEL settings resolve to - nothing hardcoded here.
client<llm> LocalGemma {
  provider openai-generic
  options {
    base_url env.LLM_BASE_URL
    api_key env.LLM_API_KEY
    model env.LLM_MODEL
  }
}
