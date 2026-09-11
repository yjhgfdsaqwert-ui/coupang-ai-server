const DISCORD_GATEWAY =
  "wss://gateway.discord.gg/?v=10&encoding=json";

const DISCORD_API =
  "https://discord.com/api/v10";

const GEMINI_MODEL =
  "gemini-3.1-flash-lite";

const INTENTS =
  (1 << 0) |   // GUILDS
  (1 << 9) |   // GUILD_MESSAGES
  (1 << 15);   // MESSAGE_CONTENT


export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Discord Gateway 연결 시작
    if (url.pathname === "/start") {
      try {
        const id = env.DISCORD_BOT.idFromName("main");
        const stub = env.DISCORD_BOT.get(id);

        const response = await stub.fetch(
          "https://discord-bot/start"
        );

        return response;
      } catch (error) {
        return new Response(
          `Start error: ${error.message}`,
          { status: 500 }
        );
      }
    }

    // 상태 확인
    if (url.pathname === "/status") {
      try {
        const id = env.DISCORD_BOT.idFromName("main");
        const stub = env.DISCORD_BOT.get(id);

        return await stub.fetch(
          "https://discord-bot/status"
        );
      } catch (error) {
        return new Response(
          `Status error: ${error.message}`,
          { status: 500 }
        );
      }
    }

    return new Response("Not Found", {
      status: 404
    });
  },

  // 매분 실행되어 Discord Gateway 연결을 확인
  async scheduled(event, env, ctx) {
    const id = env.DISCORD_BOT.idFromName("main");
    const stub = env.DISCORD_BOT.get(id);

    ctx.waitUntil(
      stub.fetch("https://discord-bot/start")
    );
  }
};


export class DiscordBot {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.socket = null;
    this.connected = false;
    this.identified = false;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/start") {
      await this.connect();

      return new Response(
        this.connected
          ? "Discord Gateway connected."
          : "Discord Gateway connection started."
      );
    }

    if (url.pathname === "/status") {
      return new Response(
        JSON.stringify({
          connected: this.connected,
          identified: this.identified
        }),
        {
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    return new Response("Not Found", {
      status: 404
    });
  }

  async connect() {
    if (this.socket) {
      if (
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING
      ) {
        return;
      }
    }

    const token = this.env.AI_coupang_discord;

    if (!token) {
      console.error(
        "AI_coupang_discord 환경변수가 없습니다."
      );
      return;
    }

    console.log("Discord Gateway 연결 시작");

    try {
      const socket = new WebSocket(
        DISCORD_GATEWAY
      );

      this.socket = socket;
      this.connected = false;
      this.identified = false;

      socket.addEventListener(
        "open",
        () => {
          console.log(
            "Discord Gateway WebSocket OPEN"
          );

          this.connected = true;
        }
      );

      socket.addEventListener(
        "message",
        event => {
          this.handleGatewayMessage(
            event.data
          );
        }
      );

      socket.addEventListener(
        "close",
        event => {
          console.log(
            `Discord Gateway CLOSED: ${event.code} ${event.reason || ""}`
          );

          this.connected = false;
          this.identified = false;
          this.clearHeartbeat();

          this.socket = null;

          this.scheduleReconnect();
        }
      );

      socket.addEventListener(
        "error",
        error => {
          console.error(
            "Discord Gateway ERROR:",
            error
          );
        }
      );

      // Discord Gateway 연결이 9분 이상 지속되면
      // 안전하게 재연결
      setTimeout(() => {
        if (
          this.socket === socket &&
          socket.readyState === WebSocket.OPEN
        ) {
          console.log(
            "9분 경과 - Discord Gateway 재연결"
          );

          try {
            socket.close(1000, "Scheduled reconnect");
          } catch {}
        }
      }, 9 * 60 * 1000);

    } catch (error) {
      console.error(
        "Discord Gateway 연결 실패:",
        error
      );

      this.connected = false;
      this.socket = null;

      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(
      async () => {
        this.reconnectTimer = null;

        await this.connect();
      },
      5000
    );
  }

  handleGatewayMessage(rawData) {
    let payload;

    try {
      payload =
        typeof rawData === "string"
          ? JSON.parse(rawData)
          : JSON.parse(
              new TextDecoder().decode(rawData)
            );
    } catch (error) {
      console.error(
        "Gateway JSON 파싱 실패:",
        error
      );

      return;
    }

    const {
      op,
      d,
      s,
      t
    } = payload;

    console.log(
      `Discord Gateway 이벤트: op=${op}, t=${t || "NONE"}`
    );

    // --------------------------------
    // OP 10 - Hello
    // --------------------------------

    if (op === 10) {
      const heartbeatInterval =
        d?.heartbeat_interval || 41250;

      this.startHeartbeat(
        heartbeatInterval
      );

      this.identify();

      return;
    }

    // --------------------------------
    // OP 11 - Heartbeat ACK
    // --------------------------------

    if (op === 11) {
      console.log(
        "Discord Heartbeat ACK"
      );

      return;
    }

    // --------------------------------
    // OP 7 - Reconnect
    // --------------------------------

    if (op === 7) {
      console.log(
        "Discord가 재연결을 요청했습니다."
      );

      this.closeAndReconnect();

      return;
    }

    // --------------------------------
    // OP 9 - Invalid Session
    // --------------------------------

    if (op === 9) {
      console.log(
        "Discord Invalid Session"
      );

      setTimeout(() => {
        this.identify();
      }, 3000);

      return;
    }

    // --------------------------------
    // Dispatch Event
    // --------------------------------

    if (op === 0) {
      if (t === "READY") {
        console.log(
          "================================"
        );

        console.log(
          "Discord 봇 로그인 성공"
        );

        console.log(
          `봇 사용자: ${d?.user?.username || "Unknown"}`
        );

        console.log(
          "================================"
        );

        this.identified = true;

        return;
      }

      if (t === "MESSAGE_CREATE") {
        // 비동기로 Gemini 요청
        this.handleMessageCreate(d);

        return;
      }
    }
  }

  startHeartbeat(interval) {
    this.clearHeartbeat();

    // 첫 heartbeat
    this.sendHeartbeat();

    this.heartbeatTimer = setInterval(
      () => {
        this.sendHeartbeat();
      },
      interval
    );
  }

  clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(
        this.heartbeatTimer
      );

      this.heartbeatTimer = null;
    }
  }

  sendHeartbeat() {
    if (
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    try {
      this.socket.send(
        JSON.stringify({
          op: 1,
          d: null
        })
      );

      console.log(
        "Discord Heartbeat 전송"
      );
    } catch (error) {
      console.error(
        "Heartbeat 전송 실패:",
        error
      );
    }
  }

  identify() {
    if (
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    const token =
      this.env.AI_coupang_discord;

    if (!token) {
      console.error(
        "AI_coupang_discord 환경변수가 없습니다."
      );

      return;
    }

    try {
      this.socket.send(
        JSON.stringify({
          op: 2,

          d: {
            token,

            intents: INTENTS,

            properties: {
              os: "linux",
              browser: "cloudflare-worker",
              device: "cloudflare-worker"
            }
          }
        })
      );

      console.log(
        "Discord Identify 전송"
      );

    } catch (error) {
      console.error(
        "Identify 전송 실패:",
        error
      );
    }
  }

  closeAndReconnect() {
    this.clearHeartbeat();

    if (this.socket) {
      try {
        this.socket.close(
          1000,
          "Discord requested reconnect"
        );
      } catch {}
    }

    this.socket = null;
    this.connected = false;
    this.identified = false;

    this.scheduleReconnect();
  }

  async handleMessageCreate(message) {
    if (!message) {
      return;
    }

    // --------------------------------
    // 봇 메시지는 무시
    // --------------------------------

    if (message.author?.bot) {
      return;
    }

    // --------------------------------
    // 허용된 채널만 처리
    // --------------------------------

    const devChannel =
      this.env.AI_coupang_discord_dev_channel;

    const userChannel =
      this.env.AI_coupang_discord_user_channel;

    const channelId =
      String(message.channel_id);

    if (
      channelId !== String(devChannel) &&
      channelId !== String(userChannel)
    ) {
      console.log(
        `허용되지 않은 채널 메시지 무시: ${channelId}`
      );

      return;
    }

    const content =
      message.content?.trim();

    if (!content) {
      return;
    }

    console.log(
      `Discord 메시지 수신: ${content}`
    );

    // --------------------------------
    // Gemini 호출
    // --------------------------------

    try {
      const answer =
        await this.askGemini(content);

      if (!answer) {
        console.error(
          "Gemini 응답이 비어 있습니다."
        );

        return;
      }

      // --------------------------------
      // Discord 답장
      // --------------------------------

      await this.sendDiscordMessage(
        channelId,
        answer
      );

    } catch (error) {
      console.error(
        "AI 처리 실패:",
        error
      );

      try {
        await this.sendDiscordMessage(
          channelId,
          `AI 처리 중 오류가 발생했습니다.\n\`${error.message}\``
        );
      } catch (sendError) {
        console.error(
          "오류 메시지 전송 실패:",
          sendError
        );
      }
    }
  }

  async askGemini(userMessage) {
    const apiKey =
      this.env.AI_coupang_api;

    if (!apiKey) {
      throw new Error(
        "AI_coupang_api 환경변수가 없습니다."
      );
    }

    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

    console.log(
      "Gemini API 요청 시작"
    );

    const response =
      await fetch(endpoint, {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "x-goog-api-key":
            apiKey
        },

        body: JSON.stringify({
          contents: [
            {
              role: "user",

              parts: [
                {
                  text: userMessage
                }
              ]
            }
          ],

          generationConfig: {
            temperature: 0.7,
            topP: 0.9,
            maxOutputTokens: 2048
          }
        })
      });

    const text =
      await response.text();

    if (!response.ok) {
      console.error(
        `Gemini API 오류 ${response.status}:`,
        text
      );

      throw new Error(
        `Gemini API ${response.status}: ${text}`
      );
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        "Gemini 응답 JSON 파싱 실패"
      );
    }

    const answer =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

    if (!answer) {
      console.error(
        "Gemini 응답:",
        JSON.stringify(data)
      );

      throw new Error(
        "Gemini가 답변을 반환하지 않았습니다."
      );
    }

    console.log(
      "Gemini API 응답 성공"
    );

    return answer;
  }

  async sendDiscordMessage(
    channelId,
    content
  ) {
    const token =
      this.env.AI_coupang_discord;

    if (!token) {
      throw new Error(
        "AI_coupang_discord 환경변수가 없습니다."
      );
    }

    // Discord 메시지는 2000자 제한
    const chunks =
      this.splitMessage(
        content,
        1900
      );

    for (const chunk of chunks) {
      const response =
        await fetch(
          `${DISCORD_API}/channels/${channelId}/messages`,
          {
            method: "POST",

            headers: {
              "Authorization":
                `Bot ${token}`,

              "Content-Type":
                "application/json"
            },

            body: JSON.stringify({
              content: chunk
            })
          }
        );

      if (!response.ok) {
        const errorText =
          await response.text();

        console.error(
          `Discord 메시지 전송 실패 ${response.status}:`,
          errorText
        );

        throw new Error(
          `Discord API ${response.status}: ${errorText}`
        );
      }

      console.log(
        "Discord 메시지 전송 성공"
      );
    }
  }

  splitMessage(text, maxLength) {
    if (text.length <= maxLength) {
      return [text];
    }

    const chunks = [];

    let remaining = text;

    while (remaining.length > maxLength) {
      let cut =
        remaining.lastIndexOf(
          "\n",
          maxLength
        );

      if (cut < 500) {
        cut =
          remaining.lastIndexOf(
            " ",
            maxLength
          );
      }

      if (cut < 1) {
        cut = maxLength;
      }

      chunks.push(
        remaining.slice(0, cut)
      );

      remaining =
        remaining.slice(cut).trimStart();
    }

    if (remaining.length > 0) {
      chunks.push(remaining);
    }

    return chunks;
  }
}
