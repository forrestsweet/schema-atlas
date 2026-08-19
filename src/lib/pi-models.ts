import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { basetenProvider } from "@earendil-works/pi-ai/providers/baseten";
import { cerebrasProvider } from "@earendil-works/pi-ai/providers/cerebras";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { fireworksProvider } from "@earendil-works/pi-ai/providers/fireworks";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { groqProvider } from "@earendil-works/pi-ai/providers/groq";
import { huggingfaceProvider } from "@earendil-works/pi-ai/providers/huggingface";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import { minimaxProvider } from "@earendil-works/pi-ai/providers/minimax";
import { minimaxCnProvider } from "@earendil-works/pi-ai/providers/minimax-cn";
import { mistralProvider } from "@earendil-works/pi-ai/providers/mistral";
import { moonshotaiProvider } from "@earendil-works/pi-ai/providers/moonshotai";
import { moonshotaiCnProvider } from "@earendil-works/pi-ai/providers/moonshotai-cn";
import { nvidiaProvider } from "@earendil-works/pi-ai/providers/nvidia";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { togetherProvider } from "@earendil-works/pi-ai/providers/together";
import { vercelAIGatewayProvider } from "@earendil-works/pi-ai/providers/vercel-ai-gateway";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import { zaiProvider } from "@earendil-works/pi-ai/providers/zai";
import { zaiCodingCnProvider } from "@earendil-works/pi-ai/providers/zai-coding-cn";

const providers = [
  anthropicProvider(),
  basetenProvider(),
  cerebrasProvider(),
  deepseekProvider(),
  fireworksProvider(),
  googleProvider(),
  groqProvider(),
  huggingfaceProvider(),
  kimiCodingProvider(),
  minimaxProvider(),
  minimaxCnProvider(),
  mistralProvider(),
  moonshotaiProvider(),
  moonshotaiCnProvider(),
  nvidiaProvider(),
  openaiProvider(),
  openrouterProvider(),
  togetherProvider(),
  vercelAIGatewayProvider(),
  xaiProvider(),
  zaiProvider(),
  zaiCodingCnProvider(),
] satisfies readonly Provider[];

export type PiBuiltinProvider = {
  baseUrl: string;
  id: string;
  models: readonly {
    id: string;
    name: string;
    supportsThinking: boolean;
  }[];
  name: string;
};

export const piBuiltinProviders: readonly PiBuiltinProvider[] = providers.map(
  (provider) => ({
    baseUrl: provider.baseUrl ?? "",
    id: provider.id,
    models: provider.getModels().map((model) => ({
      id: model.id,
      name: model.name,
      supportsThinking: getSupportedThinkingLevels(model).length > 1,
    })),
    name: provider.name,
  }),
);

const providerById = new Map(providers.map((provider) => [provider.id, provider]));

export const getPiBuiltinProvider = (providerId: string) =>
  providerById.get(providerId);

export const getPiBuiltinModel = (
  providerId: string,
  modelId: string,
): Model<Api> | undefined =>
  providerById
    .get(providerId)
    ?.getModels()
    .find((model) => model.id === modelId);

export const isPiBuiltinModel = (model: Model<Api>) =>
  getPiBuiltinModel(model.provider, model.id) === model;
