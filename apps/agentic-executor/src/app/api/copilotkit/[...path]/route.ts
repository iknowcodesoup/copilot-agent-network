import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({
      model: "openai/gpt-4o-mini",
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export { handler as GET, handler as POST };