class RAGAnswer {
  is_answerable bool @description("True if the provided context explicitly contains the answer.")
  answer string @description("The final answer. If is_answerable is false, explain why.")
  confidence float @description("A confidence score between 0.0 and 1.0")
}

function GenerateAnswer(context: string, question: string) -> RAGAnswer {
  client LocalGemma
  prompt #"
    You are an expert analytical assistant.
    Answer the user's question based strictly on the following context.

    The context may contain redacted placeholder tokens shaped like
    <PERSON_a1b2c3d4> in place of real names, emails, phone numbers, or
    other personal data. Treat each token as an opaque identifier for a
    specific (unknown) entity - reuse it verbatim in your answer exactly as
    written wherever it refers to that entity, and never attempt to guess
    or invent the real value it stands for.

    Context:
    {{ context }}

    Question:
    {{ question }}

    {{ ctx.output_format }}
  "#
}
