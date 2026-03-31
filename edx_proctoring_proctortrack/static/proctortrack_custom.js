import { handlerWrapper } from "@edx/edx-proctoring";

const CONFIG = (() => {
  try {
    const raw = process.env.JS_ENV_EXTRA_CONFIG;
    return typeof raw === "string" ? JSON.parse(raw) : raw || {};
  } catch (error) {
    console.error("Proctortrack: error parsing config", error);
    return {};
  }
})();
const CDN_URL = CONFIG.PROCTORTRACK_CDN_URL;
const KEY = CONFIG.PROCTORTRACK_CONFIG_KEY;
const PUBLIC_KEY_B64 = CONFIG.PROCTORTRACK_PUBLIC_KEY;
const ET1_BASE_URL = "https://app.verificient.com:54545";
const ET2_BASE_URL = "http://localhost:54545/a7f3e9d2c5b8/ptx/app";
const RETRY_CONFIG = {
  maxRetries: 5,
  retryDelay: 2000,
  timeoutDelay: 10000,
};

const base64ToArrayBuffer = (base64) => {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};

const getPublicKey = async () => {
  const keyBuffer = base64ToArrayBuffer(PUBLIC_KEY_B64);
  return await crypto.subtle.importKey(
    "spki",
    keyBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
};

const verifySignature = async (data, signature) => {
  try {
    const publicKey = await getPublicKey();
    const dataBuffer = new TextEncoder().encode(JSON.stringify(data));
    const signatureBuffer = base64ToArrayBuffer(signature);
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      signatureBuffer,
      dataBuffer
    );
  } catch (error) {
    console.error("Proctortrack: signature validation failed", error);
    return false;
  }
};

const responseValidator = async (data) => {
  const { signature, ...payload } = data;

  if (!signature) {
    console.error("Proctortrack: invalid response", data);
    throw new Error("Invalid response");
  }

  const isValid = await verifySignature(payload, signature);
  if (!isValid) {
    throw new Error("Invalid signature");
  }

  if (
    payload.timestamp &&
    Math.abs(Date.now() - payload.timestamp) > 10000
  ) {
    console.error("Proctortrack: invalid timestamp", payload);
    throw new Error("Invalid timestamp");
  }

  return payload;
};

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Request timed out while checking status");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function makeRequest(url, options, dataValidator, errorMessage, config = RETRY_CONFIG, responseProcessor = null) {
  return new Promise((resolve, reject) => {
    let retryCount = 0;

    async function attempt() {
      try {
        const response = await fetchWithTimeout(url, options, config.timeoutDelay);
        if (!response.ok) {
          throw new Error(errorMessage);
        }
        const data = await response.json();
        const processed = responseProcessor ? await responseProcessor(data) : data;
        const result = dataValidator(processed);
        return resolve(result);
      } catch (error) {
        if (error.nonRetryable) {
          return reject(error);
        }
        if (retryCount < config.maxRetries) {
          retryCount++;
          console.log(
            `Checking application status, attempt ${retryCount}/${config.maxRetries}`
          );
          await new Promise((r) => setTimeout(r, config.retryDelay));
          return attempt();
        }
        if (error.message === "Failed to fetch" || error.name === "TypeError") {
          return reject(
            new Error("Proctortrack app is not running.")
          );
        }
        return reject(error);
      }
    }

    return attempt();
  });
}

const createET1Provider = () => ({
  checkStatus(attemptId, timeout = 150000) {
    const retryDelay = Math.floor(timeout / 5);
    const config = { maxRetries: 5, retryDelay, timeoutDelay: retryDelay };

    const dataValidator = (data) => {
      if (data.proctoring) {
        return { proctoring_started: true };
      }
      const err = new Error(
        "Proctortrack app is running but proctoring hasn't started."
      );
      err.nonRetryable = true;
      throw err;
    };

    return makeRequest(
      ET1_BASE_URL + "/proxy_server/app/proctoring_started/",
      { method: "GET" },
      dataValidator,
      "Failed to check proctoring status.",
      config
    );
  },

  async close() {
    try {
      const response = await fetchWithTimeout(
        ET1_BASE_URL + "/proxy_server/app/close_proctoring",
        { method: "GET" },
        30000
      );
      if (!response.ok) {
        throw new Error("Failed to close proctoring session.");
      }
      return { closing_proctoring: true };
    } catch (error) {
      console.error("Proctortrack: error closing proctoring session", error);
      throw new Error("Failed to close proctoring session.");
    }
  },
});

const createET2Provider = () => ({
  checkStatus() {
    const url = `${ET2_BASE_URL}/status`;
    const options = {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    };

    const dataValidator = (data) => {
      const { is_et_online, is_proctoring_started, is_proctoring_ended } = data;
      if (is_et_online && is_proctoring_ended) {
        throw new Error("Proctortrack app is running but proctoring has ended.");
      }
      if (is_et_online && is_proctoring_started) {
        return { proctoring_started: true };
      }
      if (is_et_online && !is_proctoring_started) {
        throw new Error(
          "Proctortrack app is running but proctoring hasn't started."
        );
      }
      throw new Error("Proctortrack app is not running.");
    };

    return makeRequest(
      url,
      options,
      dataValidator,
      "Failed to check proctoring status.",
      RETRY_CONFIG,
      responseValidator
    );
  },

  close() {
    const url = `${ET2_BASE_URL}/close`;
    const randomBytes = crypto.getRandomValues(new Uint8Array(16));
    const challenge = Array.from(randomBytes, (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");

    const options = {
      method: "POST",
      body: JSON.stringify({
        challenge: challenge,
        clientTimestamp: Date.now(),
      }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    };

    const dataValidator = (data) => {
      const { is_et_online, is_proctoring_ended } = data;
      if (is_et_online && is_proctoring_ended) {
        return { closing_proctoring: true };
      }
      throw new Error("Failed to close proctoring session.");
    };

    return makeRequest(
      url,
      options,
      dataValidator,
      "Failed to close proctoring session.",
      RETRY_CONFIG,
      responseValidator
    );
  },
});

const createFirebaseProvider = () => {
  let isCDNLoaded = false;
  let database = null;
  let presenceListener = null;

  const loadCDN = () => {
    if (isCDNLoaded) {
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("GET", CDN_URL, false);
    xhr.onload = function () {
      eval(xhr.response);
      isCDNLoaded = true;
      setupDB();
    };
    xhr.onerror = function (error) {
      console.error("Failed to initialize proctortrack script", error);
    };
    xhr.send();
  };

  const setupDB = () => {
    if (!isCDNLoaded) {
      setTimeout(loadCDN, 500);
      return;
    }
    const { vtKey, vtDecrypt } = self["proctortrack"];
    const config = vtDecrypt(KEY, vtKey);
    self.firebase.initializeApp(JSON.parse(config));
    database = self.firebase.database();
  };

  const initPresenceAPI = (sessionKey) => {
    if (!sessionKey) {
      return;
    }
    const connectionRef = database.ref(".info/connected");
    const sessionRef = database.ref(`/sessions/${sessionKey}`);
    if (!presenceListener) {
      presenceListener = connectionRef.on("value", (snap) => {
        if (snap.val() === true) {
          sessionRef.update({ is_custom_js_online: true });
          sessionRef.onDisconnect().update({ is_custom_js_online: false });
        }
      });
    }
  };

  loadCDN();

  return {
    checkStatus(sessionKey, timeout = 150000) {
      initPresenceAPI(sessionKey);
      return new Promise((resolve, reject) => {
        let maxFailedAttemptCount = 5;
        let failedAttemptCount = 0;
        let retryInterval = Math.floor(timeout / maxFailedAttemptCount);

        if (!sessionKey) {
          console.error("Proctortrack: missing session key for status check");
          reject(Error("Failed to check proctoring status."));
          return;
        }
        const sessionRef = database.ref(`/sessions/${sessionKey}`);

        const onData = (data) => {
          const value = data.val();
          const { is_et_online, is_proctoring_started } = value;
          if (is_et_online && is_proctoring_started) {
            resolve({ proctoring_started: true });
          } else {
            failedAttemptCount += 1;
            if (failedAttemptCount < maxFailedAttemptCount) {
              setTimeout(() => {
                sessionRef.once("value", onData, onError);
              }, retryInterval);
            } else if (is_et_online && !is_proctoring_started) {
              console.error("Proctortrack: proctoring hasn't started", value);
              reject(
                Error(
                  "Proctortrack app is running but proctoring hasn't started."
                )
              );
            } else {
              console.error("Proctortrack: app is not running", value);
              reject(Error("Proctortrack app is not running."));
            }
          }
        };

        const onError = (error) => {
          console.error("Proctortrack: status check failed", error);
          reject(Error("Failed to check proctoring status."));
        };

        sessionRef.once("value", onData, onError);
      });
    },

    close(sessionKey) {
      initPresenceAPI(sessionKey);
      return new Promise((resolve, reject) => {
        if (!sessionKey) {
          console.error("Proctortrack: missing session key for close");
          reject(Error("Failed to close proctoring session."));
          return;
        }
        const sessionRef = database.ref(`/sessions/${sessionKey}`);

        const onData = (data) => {
          const value = data.val();
          const { is_exam_ended } = value;
          if (is_exam_ended) {
            resolve({ closing_proctoring: true });
          } else {
            console.error("Proctortrack: app is not closed", value);
            reject(Error("Failed to close proctoring session."));
          }
        };

        const onError = (error) => {
          console.error("Proctortrack: close status check failed", error);
          reject(Error("Failed to close proctoring session."));
        };

        sessionRef
          .update({ is_exam_ended: true })
          .then(() => {
            sessionRef.once("value", onData, onError);
          })
          .catch((error) => {
            console.error("Proctortrack: close request failed", error);
            reject(Error("Failed to close proctoring session."));
          });
      });
    },
  };
};

const resolveProvider = () => {
  if (CDN_URL && CDN_URL.includes("fb_cjs") && KEY && KEY.length > 2) {
    return createFirebaseProvider();
  }
  if (PUBLIC_KEY_B64) {
    return createET2Provider();
  }
  return createET1Provider();
};

let provider;

class PTProctoringServiceHandler {
  constructor() {
    provider = resolveProvider();
  }

  onStartExamAttempt(timeout, attemptId) {
    return provider.checkStatus(attemptId, timeout);
  }

  onEndExamAttempt(attemptId) {
    return provider.close(attemptId);
  }

  onPing(timeout, attemptId) {
    return provider.checkStatus(attemptId, timeout);
  }
}

export default handlerWrapper(PTProctoringServiceHandler);
