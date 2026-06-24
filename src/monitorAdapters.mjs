export class MonitorAdapter {
  constructor(name) {
    this.name = name;
  }

  async listTargets() {
    throw new Error(`${this.name} 尚未实现 listTargets`);
  }

  async fetchUpdates() {
    throw new Error(`${this.name} 尚未实现 fetchUpdates`);
  }
}

export class OpenClawAdapter extends MonitorAdapter {
  constructor(config = {}) {
    super("OpenClaw");
    this.config = config;
  }
}

export class HermesAdapter extends MonitorAdapter {
  constructor(config = {}) {
    super("Hermes");
    this.config = config;
  }
}

export function describeMonitorAdapters() {
  return [
    {
      provider: "OpenClaw",
      status: "预留",
      requiredConfig: ["baseUrl", "apiKey", "targets"],
      purpose: "后续用于持续监测账号、关键词或内容更新。"
    },
    {
      provider: "Hermes",
      status: "预留",
      requiredConfig: ["baseUrl", "apiKey", "targets"],
      purpose: "后续用于接入外部内容监测、告警或数据同步。"
    }
  ];
}

