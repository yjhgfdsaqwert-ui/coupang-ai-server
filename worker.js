const DISCORD_GATEWAY =
  "wss://gateway.discord.gg/?v=10&encoding=json";

const DISCORD_API =
  "https://discord.com/api/v10";

const GEMINI_MODEL =
  "gemini-3.5-flash-lite";

const INTENTS =
  (1 << 0) |   // GUILDS
  (1 << 9) |   // GUILD_MESSAGES
  (1 << 15);   // MESSAGE_CONTENT


export default {

  async fetch(request, env) {
    const url = new URL(request.url);

    // ========================================
    // 상태 확인
    // ========================================

    if (url.pathname === "/status") {
      try {
        const id =
          env.DISCORD_BOT.idFromName("main");

        const stub =
          env.DISCORD_BOT.get(id);

        const response =
          await stub.fetch(
            "https://discord-bot/status"
          );

        return response;

      } catch (error) {

        return new Response(
          JSON.stringify({
            worker: true,
            error: error.message
          }, null, 2),
          {
            status: 500,
            headers: {
              "Content-Type":
                "application/json"
            }
          }
        );
      }
    }


    // ========================================
    // 기본 응답
    // ========================================

    return new Response(
      "Coupang AI Discord Bot Server",
      {
        status: 200
      }
    );
  },


  // ========================================
  // Cron Trigger
  // 매분 자동 실행
  // ========================================

  async scheduled(event, env, ctx) {

    try {

      const id =
        env.DISCORD_BOT.idFromName("main");

      const stub =
        env.DISCORD_BOT.get(id);


      ctx.waitUntil(
        stub.fetch(
          "https://discord-bot/connect"
        )
      );

    } catch (error) {

      console.error(
        "Cron 실행 실패:",
        error
      );
    }
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

    this.sequence = null;

    // 상태 정보
    this.status = {
      createdAt:
        new Date().toISOString(),

      lastCron:
        null,

      lastAction:
        "Durable Object created",

      lastEvent:
        null,

      lastEventTime:
        null,

      lastError:
        null,

      gateway:
        "not_connected",

      connected:
        false,

      identified:
        false
    };
  }


  // ========================================
  // 요청 처리
  // ========================================

  async fetch(request) {

    const url =
      new URL(request.url);


    // ======================================
    // 자동 연결 요청
    // ======================================

    if (
      url.pathname === "/connect"
    ) {

      this.status.lastCron =
        new Date().toISOString();

      this.status.lastAction =
        "Cron called /connect";

      await this.connect();


      return new Response(
        JSON.stringify(
          this.status,
          null,
          2
        ),
        {
          headers: {
            "Content-Type":
              "application/json"
          }
        }
      );
    }


    // ======================================
    // 상태 확인
    // ======================================

    if (
      url.pathname === "/status"
    ) {

      return new Response(
        JSON.stringify(
          {
            ...this.status,

            connected:
              this.connected,

            identified:
              this.identified,

            socketState:
              this.getSocketState()
          },
          null,
          2
        ),
        {
          headers: {
            "Content-Type":
              "application/json"
          }
        }
      );
    }


    return new Response(
      "Not Found",
      {
        status: 404
      }
    );
  }


  // ========================================
  // WebSocket 상태
  // ========================================

  getSocketState() {

    if (!this.socket) {
      return "null";
    }

    if (
      this.socket.readyState ===
      WebSocket.CONNECTING
    ) {
      return "CONNECTING";
    }

    if (
      this.socket.readyState ===
      WebSocket.OPEN
    ) {
      return "OPEN";
    }

    if (
      this.socket.readyState ===
      WebSocket.CLOSING
    ) {
      return "CLOSING";
    }

    if (
      this.socket.readyState ===
      WebSocket.CLOSED
    ) {
      return "CLOSED";
    }

    return "UNKNOWN";
  }


  // ========================================
  // Discord Gateway 연결
  // ========================================

  async connect() {

    // 이미 연결되어 있으면 아무것도 하지 않음
    if (this.socket) {

      if (
        this.socket.readyState ===
          WebSocket.OPEN ||

        this.socket.readyState ===
          WebSocket.CONNECTING
      ) {

        this.status.lastAction =
          "Already connected or connecting";

        return;
      }
    }


    const token =
      this.env.AI_coupang_discord;


    if (!token) {

      const error =
        "AI_coupang_discord 환경변수가 없습니다.";

      this.status.lastError =
        error;

      this.status.lastAction =
        "Discord token missing";

      this.status.gateway =
        "token_missing";

      return;
    }


    this.status.lastAction =
      "Starting Discord Gateway connection";

    this.status.gateway =
      "connecting";


    try {

      const socket =
        new WebSocket(
          DISCORD_GATEWAY
        );


      this.socket =
        socket;

      this.connected =
        false;

      this.identified =
        false;


      this.status.connected =
        false;

      this.status.identified =
        false;


      this.status.lastAction =
        "WebSocket created";


      // ====================================
      // OPEN
      // ====================================

      socket.addEventListener(
        "open",
        () => {

          this.connected =
            true;

          this.status.connected =
            true;

          this.status.gateway =
            "connected";

          this.status.lastAction =
            "Discord WebSocket OPEN";

          this.status.lastError =
            null;
        }
      );


      // ====================================
      // MESSAGE
      // ====================================

      socket.addEventListener(
        "message",
        event => {

          this.handleGatewayMessage(
            event.data
          );
        }
      );


      // ====================================
      // CLOSE
      // ====================================

      socket.addEventListener(
        "close",
        event => {

          this.connected =
            false;

          this.identified =
            false;

          this.status.connected =
            false;

          this.status.identified =
            false;

          this.status.gateway =
            "closed";

          this.status.lastAction =
            `Gateway CLOSED: ${event.code}`;

          this.clearHeartbeat();

          this.socket =
            null;

          this.scheduleReconnect();
        }
      );


      // ====================================
      // ERROR
      // ====================================

      socket.addEventListener(
        "error",
        error => {

          this.status.gateway =
            "error";

          this.status.lastAction =
            "WebSocket error";

          this.status.lastError =
            "Discord WebSocket error";
        }
      );


      // ====================================
      // 9분 후 안전 재연결
      // ====================================

      setTimeout(
        () => {

          if (
            this.socket === socket &&
            socket.readyState ===
              WebSocket.OPEN
          ) {

            this.status.lastAction =
              "9 minute scheduled reconnect";


            try {

              socket.close(
                1000,
                "Scheduled reconnect"
              );

            } catch {}
          }

        },
        9 * 60 * 1000
      );


    } catch (error) {

      this.status.gateway =
        "connection_failed";

      this.status.lastAction =
        "Discord Gateway connection failed";

      this.status.lastError =
        error.message;

      this.connected =
        false;

      this.socket =
        null;

      this.scheduleReconnect();
    }
  }


  // ========================================
  // 자동 재연결
  // ========================================

  scheduleReconnect() {

    if (
      this.reconnectTimer
    ) {
      return;
    }


    this.status.lastAction =
      "Reconnect scheduled";


    this.reconnectTimer =
      setTimeout(
        async () => {

          this.reconnectTimer =
            null;

          await this.connect();

        },
        5000
      );
  }


  // ========================================
  // Gateway 메시지 처리
  // ========================================

  handleGatewayMessage(
    rawData
  ) {

    let payload;


    try {

      payload =
        typeof rawData === "string"
          ? JSON.parse(rawData)
          : JSON.parse(
              new TextDecoder().decode(
                rawData
              )
            );

    } catch (error) {

      this.status.lastError =
        `Gateway JSON 파싱 실패: ${error.message}`;

      return;
    }


    const {
      op,
      d,
      s,
      t
    } = payload;


    // Sequence 저장
    if (
      s !== null &&
      s !== undefined
    ) {

      this.sequence =
        s;
    }


    this.status.lastEvent =
      `op=${op}, t=${t || "NONE"}`;

    this.status.lastEventTime =
      new Date().toISOString();


    // ========================================
    // OP 10 - Hello
    // ========================================

    if (
      op === 10
    ) {

      this.status.lastAction =
        "Discord Gateway HELLO received";


      const heartbeatInterval =
        d?.heartbeat_interval ||
        41250;


      this.startHeartbeat(
        heartbeatInterval
      );


      this.identify();


      return;
    }


    // ========================================
    // OP 11 - Heartbeat ACK
    // ========================================

    if (
      op === 11
    ) {

      this.status.lastAction =
        "Heartbeat ACK received";

      return;
    }


    // ========================================
    // OP 7 - Reconnect
    // ========================================

    if (
      op === 7
    ) {

      this.status.lastAction =
        "Discord requested reconnect";


      this.closeAndReconnect();


      return;
    }


    // ========================================
    // OP 9 - Invalid Session
    // ========================================

    if (
      op === 9
    ) {

      this.status.lastAction =
        "Discord Invalid Session";


      this.identified =
        false;

      this.status.identified =
        false;


      setTimeout(
        () => {

          this.identify();

        },
        3000
      );


      return;
    }


    // ========================================
    // OP 0 - Dispatch
    // ========================================

    if (
      op === 0
    ) {

      // ======================================
      // READY
      // ======================================

      if (
        t === "READY"
      ) {

        this.identified =
          true;

        this.status.identified =
          true;

        this.status.gateway =
          "ready";

        this.status.lastAction =
          "Discord bot READY";

        this.status.lastError =
          null;


        return;
      }


      // ======================================
      // MESSAGE_CREATE
      // ======================================

      if (
        t === "MESSAGE_CREATE"
      ) {

        this.status.lastAction =
          "Discord MESSAGE_CREATE received";


        this.handleMessageCreate(
          d
        );


        return;
      }
    }
  }


  // ========================================
  // Heartbeat 시작
  // ========================================

  startHeartbeat(
    interval
  ) {

    this.clearHeartbeat();


    this.status.lastAction =
      `Heartbeat started: ${interval}ms`;


    // 첫 Heartbeat
    this.sendHeartbeat();


    this.heartbeatTimer =
      setInterval(
        () => {

          this.sendHeartbeat();

        },
        interval
      );
  }


  // ========================================
  // Heartbeat 종료
  // ========================================

  clearHeartbeat() {

    if (
      this.heartbeatTimer
    ) {

      clearInterval(
        this.heartbeatTimer
      );

      this.heartbeatTimer =
        null;
    }
  }


  // ========================================
  // Heartbeat 전송
  // ========================================

  sendHeartbeat() {

    if (
      !this.socket ||
      this.socket.readyState !==
        WebSocket.OPEN
    ) {
      return;
    }


    try {

      // Discord Gateway Heartbeat
      // d에는 마지막 sequence 또는 null
      this.socket.send(
        JSON.stringify(
          {
            op: 1,
            d: this.sequence
          }
        )
      );


      this.status.lastAction =
        "Heartbeat sent";

    } catch (error) {

      this.status.lastError =
        `Heartbeat 전송 실패: ${error.message}`;
    }
  }


  // ========================================
  // Discord Identify
  // ========================================

  identify() {

    if (
      !this.socket ||
      this.socket.readyState !==
        WebSocket.OPEN
    ) {
      return;
    }


    const token =
      this.env.AI_coupang_discord;


    if (!token) {

      this.status.lastError =
        "AI_coupang_discord 환경변수가 없습니다.";

      return;
    }


    try {

      this.socket.send(
        JSON.stringify(
          {
            op: 2,

            d: {

              token,

              intents:
                INTENTS,

              properties: {

                os:
                  "linux",

                browser:
                  "cloudflare-worker",

                device:
                  "cloudflare-worker"
              }
            }
          }
        )
      );


      this.status.lastAction =
        "Discord Identify sent";

    } catch (error) {

      this.status.lastError =
        `Identify 전송 실패: ${error.message}`;
    }
  }


  // ========================================
  // 재연결
  // ========================================

  closeAndReconnect() {

    this.clearHeartbeat();


    if (
      this.socket
    ) {

      try {

        this.socket.close(
          1000,
          "Discord requested reconnect"
        );

      } catch {}
    }


    this.socket =
      null;

    this.connected =
      false;

    this.identified =
      false;


    this.status.connected =
      false;

    this.status.identified =
      false;

    this.status.gateway =
      "reconnecting";


    this.scheduleReconnect();
  }


  // ========================================
  // Discord 메시지 처리
  // ========================================

  async handleMessageCreate(
    message
  ) {

    if (!message) {
      return;
    }


    // 봇 메시지 무시
    if (
      message.author?.bot
    ) {
      return;
    }


    const devChannel =
      this.env.AI_coupang_discord_dev_channel;

    const userChannel =
      this.env.AI_coupang_discord_user_channel;


    const channelId =
      String(
        message.channel_id
      );


    // 허용된 채널만 처리
    if (
      channelId !==
        String(devChannel) &&

      channelId !==
        String(userChannel)
    ) {

      this.status.lastAction =
        `Ignored channel: ${channelId}`;

      return;
    }


    const content =
      message.content?.trim();


    if (!content) {
      return;
    }


    this.status.lastAction =
      "Processing Discord message";


    try {

      const answer =
        await this.askGemini(
          content
        );


      if (!answer) {

        throw new Error(
          "Gemini 응답이 비어 있습니다."
        );
      }


      await this.sendDiscordMessage(
        channelId,
        answer
      );


      this.status.lastAction =
        "AI response sent to Discord";


    } catch (error) {

      this.status.lastError =
        `AI 처리 실패: ${error.message}`;


      try {

        await this.sendDiscordMessage(
          channelId,

          `AI 처리 중 오류가 발생했습니다.\n\`${error.message}\``
        );

      } catch (sendError) {

        this.status.lastError =
          `Discord 오류 메시지 전송 실패: ${sendError.message}`;
      }
    }
  }


  // ========================================
  // Gemini
  // ========================================

  async askGemini(
    userMessage
  ) {

    const apiKey =
      this.env.AI_coupang_api;


    if (!apiKey) {

      throw new Error(
        "AI_coupang_api 환경변수가 없습니다."
      );
    }


    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;


    const response =
      await fetch(
        endpoint,
        {
          method: "POST",

          headers: {

            "Content-Type":
              "application/json",

            "x-goog-api-key":
              apiKey
          },

          body:
            JSON.stringify(
              {
                contents: [

                  {
                    role:
                      "user",

                    parts: [

                      {
                        text:
                          userMessage
                      }

                    ]
                  }

                ],

                generationConfig: {

                  temperature:
                    0.7,

                  topP:
                    0.9,

                  maxOutputTokens:
                    2048
                }
              }
            )
        }
      );


    const text =
      await response.text();


    if (
      !response.ok
    ) {

      throw new Error(
        `Gemini API ${response.status}: ${text}`
      );
    }


    let data;


    try {

      data =
        JSON.parse(
          text
        );

    } catch {

      throw new Error(
        "Gemini 응답 JSON 파싱 실패"
      );
    }


    const answer =
      data
        ?.candidates?.[0]
        ?.content?.parts
        ?.map(
          part =>
            part.text || ""
        )
        .join("")
        .trim();


    if (!answer) {

      throw new Error(
        "Gemini가 답변을 반환하지 않았습니다."
      );
    }


    return answer;
  }


  // ========================================
  // Discord 메시지 전송
  // ========================================

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


    const chunks =
      this.splitMessage(
        content,
        1900
      );


    for (
      const chunk of chunks
    ) {

      const response =
        await fetch(
          `${DISCORD_API}/channels/${channelId}/messages`,
          {

            method:
              "POST",

            headers: {

              "Authorization":
                `Bot ${token}`,

              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify(
                {
                  content:
                    chunk
                }
              )
          }
        );


      if (
        !response.ok
      ) {

        const errorText =
          await response.text();


        throw new Error(
          `Discord API ${response.status}: ${errorText}`
        );
      }
    }
  }


  // ========================================
  // 메시지 분할
  // ========================================

  splitMessage(
    text,
    maxLength
  ) {

    if (
      text.length <=
        maxLength
    ) {

      return [
        text
      ];
    }


    const chunks =
      [];

    let remaining =
      text;


    while (
      remaining.length >
        maxLength
    ) {

      let cut =
        remaining.lastIndexOf(
          "\n",
          maxLength
        );


      if (
        cut < 500
      ) {

        cut =
          remaining.lastIndexOf(
            " ",
            maxLength
          );
      }


      if (
        cut < 1
      ) {

        cut =
          maxLength;
      }


      chunks.push(
        remaining.slice(
          0,
          cut
        )
      );


      remaining =
        remaining
          .slice(cut)
          .trimStart();
    }


    if (
      remaining.length >
        0
    ) {

      chunks.push(
        remaining
      );
    }


    return chunks;
  }
}
