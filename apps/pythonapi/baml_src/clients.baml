client<llm> LiteLLMGateway {
  provider openai-generic
  options {
    base_url "http://localhost:4000/v1"
    model "chat-default"
  }
}
