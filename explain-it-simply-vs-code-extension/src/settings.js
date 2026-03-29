const MODELS = {
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o (Recommended)' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast & Affordable)' },
    { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (Fastest)' },
  ],
  anthropic: [
    { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (Recommended)' },
    { id: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku (Fast)' },
    { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus (Most Capable)' },
  ],
  google: [
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (Recommended)' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (Fast)' },
    { id: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash (Experimental)' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Free Tier Available)' },
    { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
    { id: 'gemma2-9b-it', label: 'Gemma 2 9B' },
  ],
};

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI', keyHint: 'sk-...' },
  { id: 'anthropic', label: 'Anthropic (Claude)', keyHint: 'sk-ant-...' },
  { id: 'google', label: 'Google (Gemini)', keyHint: 'AIza...' },
  { id: 'groq', label: 'Groq (Free Tier)', keyHint: 'gsk_...' },
];

class SettingsManager {
  constructor(context) {
    this.context = context;
    this.secretStorage = context.secrets;
    this.globalState = context.globalState;
  }

  hasApiKey() {
    return !!this.globalState.get('eis.configured');
  }

  async saveSettings(provider, modelId, apiKey) {
    await this.secretStorage.store('eis.apiKey', apiKey);
    await this.globalState.update('eis.provider', provider);
    await this.globalState.update('eis.model', modelId);
    await this.globalState.update('eis.configured', true);
  }

  async getSettings() {
    const apiKey = await this.secretStorage.get('eis.apiKey');
    const provider = this.globalState.get('eis.provider');
    const model = this.globalState.get('eis.model');
    return { apiKey, provider, model };
  }

  async clearSettings() {
    await this.secretStorage.delete('eis.apiKey');
    await this.globalState.update('eis.configured', false);
    await this.globalState.update('eis.provider', undefined);
    await this.globalState.update('eis.model', undefined);
  }

  getProviders() { return PROVIDERS; }
  getModels(providerId) { return MODELS[providerId] || []; }
  getAllModels() { return MODELS; }
}

module.exports = { SettingsManager, PROVIDERS, MODELS };
