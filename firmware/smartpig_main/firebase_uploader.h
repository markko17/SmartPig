#pragma once

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "secrets.h"

#define DEVICE_ID "esp32s3_01"
#define HISTORY_SCHEMA_VERSION 1

struct Snapshot {
  bool ready;
  bool sensorOk;
  float temperature;
  float humidity;
  char waterLevel[16];
  bool waterTop;
  bool waterMiddle;
  bool waterBottom;
  bool rtcValid;
  char rtcDate[11];  // YYYY-MM-DD
  char rtcTime[9];   // HH:MM:SS
};

static Snapshot sharedSnap = {};
static SemaphoreHandle_t snapMutex = nullptr;
static String idToken = "";
static unsigned long tokenObtainedAt = 0;

static const unsigned long SEND_INTERVAL_MS = 5000;           // live snapshot
static const unsigned long HISTORY_INTERVAL_MS = 180000UL;    // history record: 3 minutes
static const unsigned long TOKEN_REFRESH_MS = 50UL * 60UL * 1000UL;

// Called from loop(): copies the latest readings for the network task
void uploaderUpdate(bool sensorOk, float temperature, float humidity,
                    const char *waterLevel, bool top, bool middle, bool bottom,
                    bool rtcValid, const char *rtcDate, const char *rtcTime) {
  if (snapMutex == nullptr) return;
  if (xSemaphoreTake(snapMutex, pdMS_TO_TICKS(20)) != pdTRUE) return;

  sharedSnap.sensorOk = sensorOk;
  sharedSnap.temperature = temperature;
  sharedSnap.humidity = humidity;
  strlcpy(sharedSnap.waterLevel, waterLevel, sizeof(sharedSnap.waterLevel));
  sharedSnap.waterTop = top;
  sharedSnap.waterMiddle = middle;
  sharedSnap.waterBottom = bottom;
  sharedSnap.rtcValid = rtcValid;
  strlcpy(sharedSnap.rtcDate, rtcDate, sizeof(sharedSnap.rtcDate));
  strlcpy(sharedSnap.rtcTime, rtcTime, sizeof(sharedSnap.rtcTime));
  sharedSnap.ready = true;

  xSemaphoreGive(snapMutex);
}

static bool uploaderConnectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  Serial.println("[net] Connecting to Wi-Fi...");
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    vTaskDelay(pdMS_TO_TICKS(500));
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[net] Wi-Fi connected. IP: ");
    Serial.println(WiFi.localIP());
    return true;
  }

  Serial.println("[net] Wi-Fi failed. Will retry.");
  return false;
}

static bool uploaderSignIn() {
  WiFiClientSecure client;
  client.setInsecure();  // TEST ONLY: certificate not verified

  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(8000);

  String url =
      String("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=") +
      FIREBASE_API_KEY;
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");

  JsonDocument req;
  req["email"] = DEVICE_EMAIL;
  req["password"] = DEVICE_PASSWORD;
  req["returnSecureToken"] = true;

  String body;
  serializeJson(req, body);

  int code = http.POST(body);
  String response = http.getString();
  http.end();

  if (code != 200) {
    Serial.print("[net] Sign-in failed. HTTP ");
    Serial.println(code);
    return false;
  }

  JsonDocument res;
  if (deserializeJson(res, response)) {
    Serial.println("[net] Sign-in failed: bad response.");
    return false;
  }

  idToken = res["idToken"].as<String>();
  tokenObtainedAt = millis();
  Serial.println("[net] Firebase sign-in OK.");
  return true;
}

// Builds the JSON body. history=false -> live snapshot, history=true -> history record
static String buildBody(const Snapshot &s, bool history) {
  char tempText[12];
  char humText[12];

  JsonDocument doc;
  doc["sensorOk"] = s.sensorOk;

  // Failed sensor = the fields are left out. Never send an old or zero value.
  if (s.sensorOk) {
    snprintf(tempText, sizeof(tempText), "%.1f", s.temperature);
    snprintf(humText, sizeof(humText), "%.1f", s.humidity);
    doc["temperature"] = serialized(tempText);
    doc["humidity"] = serialized(humText);
  }

  doc["waterLevel"] = s.waterLevel;
  doc["waterTop"] = s.waterTop;
  doc["waterMiddle"] = s.waterMiddle;
  doc["waterBottom"] = s.waterBottom;

  doc["rtcValid"] = s.rtcValid;
  if (s.rtcValid) {
    doc["rtcDate"] = s.rtcDate;
    doc["rtcTime"] = s.rtcTime;
  }

  if (history) {
    doc["deviceId"] = DEVICE_ID;
    doc["schemaVersion"] = HISTORY_SCHEMA_VERSION;
    doc["recordedAt"][".sv"] = "timestamp";  // Firebase server time
  } else {
    doc["lastUpdated"][".sv"] = "timestamp";  // Firebase server time
  }

  String body;
  serializeJson(doc, body);
  return body;
}

// PUT replaces /smartpig. POST adds a new record under /smartpigHistory.
static int uploaderSend(const Snapshot &s, bool history) {
  String body = buildBody(s, history);

  WiFiClientSecure client;
  client.setInsecure();  // TEST ONLY

  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(8000);

  String path = history ? "/smartpigHistory.json" : "/smartpig.json";
  String url = String("https://") + FIREBASE_DB_HOST + path + "?auth=" + idToken;

  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");

  int code = history ? http.POST(body) : http.PUT(body);
  String response = http.getString();
  http.end();

  Serial.print(history ? "[net] History write -> HTTP " : "[net] Write -> HTTP ");
  Serial.println(code);
  if (code != 200) Serial.println(response);

  return code;
}

static void uploaderTask(void *param) {
  unsigned long lastSend = 0;
  unsigned long lastHistory = millis();  // first history record after one full interval

  for (;;) {
    if (!uploaderConnectWiFi()) {
      vTaskDelay(pdMS_TO_TICKS(5000));
      continue;
    }

    if (idToken == "" || millis() - tokenObtainedAt > TOKEN_REFRESH_MS) {
      if (!uploaderSignIn()) {
        vTaskDelay(pdMS_TO_TICKS(5000));
        continue;
      }
    }

    if (millis() - lastSend >= SEND_INTERVAL_MS) {
      lastSend = millis();

      Snapshot copy;
      bool haveData = false;

      if (xSemaphoreTake(snapMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        copy = sharedSnap;
        haveData = copy.ready;
        xSemaphoreGive(snapMutex);
      }

      if (haveData) {
        int code = uploaderSend(copy, false);
        if (code == 401 || code == 403) idToken = "";  // force new sign-in

        // Log history only after a successful live write, once per interval
        if (code == 200 && millis() - lastHistory >= HISTORY_INTERVAL_MS) {
          lastHistory = millis();
          int hCode = uploaderSend(copy, true);
          if (hCode == 401 || hCode == 403) idToken = "";
        }
      }
    }

    vTaskDelay(pdMS_TO_TICKS(200));
  }
}

void uploaderBegin() {
  snapMutex = xSemaphoreCreateMutex();
  xTaskCreatePinnedToCore(uploaderTask, "uploader", 16384, nullptr, 1, nullptr, 0);
}