# Specyfikacja pluginu `homebridge-satel-integra`

Dokument dla Claude Code. Opisuje cel, architekturę i kroki implementacji wtyczki Homebridge integrującej centralę alarmową Satel Integra bezpośrednio z HomeKit, bez pośrednictwa Domoticz.

---

## 1. Cel projektu

Cel: **uniwersalny plugin Homebridge** do integracji centrali Satel Integra (dowolna wielkość systemu, moduł ETHM-1 lub ETHM-1 Plus) bezpośrednio z HomeKit, eliminujący potrzebę warstw pośrednich (Domoticz, Home Assistant, Node-RED).

Plugin musi obsługiwać **dowolną liczbę** encji każdego typu, skonfigurowaną w całości przez UI Homebridge Config UI X (bez ręcznej edycji plików JSON). Typy eksponowanych urządzeń HomeKit:

| Typ w Satelu | Usługa HomeKit | Zastosowanie |
|---|---|---|
| Strefa (partycja) | `SecuritySystem` | Uzbrajanie/rozbrajanie, stan alarmu |
| Wejście (czujka) | `MotionSensor` / `ContactSensor` / `SmokeSensor` / `LeakSensor` / `CarbonMonoxideSensor` / `OccupancySensor` | Detekcja ruchu, otwarcia, dymu, zalania itd. |
| Wyjście (przekaźnik bistabilny) | `Switch` | Ogólne przełączniki (pompa, oświetlenie, bramy garażowe sterowane trzymaniem) |
| Para wyjść (góra/dół, impulsowe) | `WindowCovering` | Rolety, bramy roletowe |
| Wyjście impulsowe | `LockMechanism` | Elektrozaczepy, furtki, bramy otwierane impulsem |
| Wyjście termometryczne (opcja) | `TemperatureSensor` | Pomiar temperatury, jeśli centrala ma moduły temperatury |

Liczba każdego typu jest **dowolna** i limitowana tylko rozmiarem centrali (Integra 24/32/64/128/256). Plugin nie może zakładać żadnej konkretnej topologii — ma być użyteczny zarówno dla mieszkania z jedną strefą i kilkoma czujkami, jak i dla rozbudowanej instalacji z dziesiątkami stref i setkami wejść/wyjść.

---

## 2. Materiały referencyjne (sprawdź je przed kodowaniem)

Claude Code: **zacznij od przestudiowania tych repozytoriów**, zanim zaczniesz pisać kod.

1. **Szablon pluginu Homebridge (TypeScript, dynamic platform):**
   <https://github.com/homebridge/homebridge-plugin-template>
   — struktura katalogów, `config.schema.json`, `package.json`, `tsconfig.json`, pattern `platform.ts` + `platformAccessory.ts`.

2. **Przykłady oficjalne (dynamic-platform-example-typescript):**
   <https://github.com/homebridge/homebridge-examples>

3. **Biblioteka protokołu Satel w Node.js (używamy jej):**
   <https://www.npmjs.com/package/satel-integra-integration-protocol>
   Autor: `majektom`. Ta biblioteka **tylko koduje/dekoduje ramki** protokołu integracji Satel — nie zajmuje się TCP. TCP musimy napisać sami.

4. **Implementacja TCP tego samego autora (do podglądu, nie importu):**
   <https://github.com/majektom/node-red-contrib-satel-integra-integration>
   Node `satel-integra-connection` — referencja, jak poprawnie zestawić połączenie, obsłużyć szyfrowanie AES i parsować strumień ramek.

5. **Integracja Satel w Home Assistant (Python) — wzorzec mapowania funkcji:**
   <https://github.com/home-assistant/core/tree/dev/homeassistant/components/satel_integra>
   Zwróć uwagę zwłaszcza na nazwy komend, indeksowanie stref/wyjść i obsługę zdarzeń.

6. **Specyfikacja protokołu Satel (oficjalny PDF od producenta):**
   Szukaj dokumentu „Satel Integra — protokół integracji" (ETHM-1 Plus). Jest publiczny na stronie Satela. Zawiera pełną listę komend, indeksowanie, długości pól, szyfrowanie.

7. **Homebridge Service types i charakterystyki:**
   <https://developers.homebridge.io/>
   Szczególnie: `SecuritySystem`, `WindowCovering`, `Switch`, `LockMechanism`.

---

## 3. Ograniczenia i fakty o protokole Satel (kluczowe!)

Claude Code: to musi zostać uwzględnione w architekturze, bo wpływa na design.

- **Tylko jeden klient na raz.** Moduł ETHM-1 / ETHM-1 Plus dopuszcza **jedno aktywne połączenie TCP** na raz. Jeśli użytkownik ma jeszcze Domoticz podpięty do Satela, wtyczka nie zadziała równolegle — musi odłączyć stare połączenie.
- **ETHM-1 vs ETHM-1 Plus.** Tylko Plus ze firmware ≥ 2.0 wspiera szyfrowane połączenie i pełen zestaw komend. Plugin powinien działać w trybie nieszyfrowanym na obu, a szyfrowanie (AES-192) jako opcja.
- **Port domyślny:** 7094 TCP.
- **Format ramki:**
  `FE FE <data> <CRC16-hi> <CRC16-lo> FE 0D`
  Bajt `FE` w polu `data` musi być stuffingowany jako `FE F0`. CRC jest liczone z payloadu przed stuffingiem. Biblioteka `satel-integra-integration-protocol` to obsługuje — nie implementuj od nowa.
- **Autoryzacja.** Każda komenda zmieniająca stan (uzbroj, rozbroj, włącz wyjście) wymaga przesłania kodu użytkownika w ramce. Kod ma postać 8 nibbli BCD (16 znaków hex), uzupełniany `F`.
- **Indeksowanie.** Satel liczy strefy / wyjścia / wejścia od 1, tablice bitowe w ramkach — od bitu 0. W konfiguracji pluginu podajemy **numer Satela (od 1)**, w komunikacji konwertujemy na indeks bitu.
- **Odczyt stanu — strategia.** Najefektywniej: polling komendą `new_data` (0x7F) co ~1 sekundę. Zwraca bitmapę „co się zmieniło". Dopiero dla zmienionych kategorii pobieramy szczegóły (np. `zones_violation`, `outputs_state`, `partitions_armed_mode_2`). Nie odpytuj wszystkiego co sekundę — to zamula moduł.
- **Rolety.** Satel wspiera kilka modeli sterowania roletami. My zakładamy **dwa wyjścia na roletę** (góra/dół), impulsowe (MONO). Uzyskanie aktualnej pozycji procentowej spoza Satel-a nie jest możliwe — estymujemy ją czasowo.

---

## 4. Stack technologiczny

- **Node.js:** ≥ 20 LTS (wymaganie aktualnego szablonu Homebridge).
- **TypeScript** w strict mode.
- **Homebridge API:** ^1.8 z kompatybilnością forward do v2.0 (szablon to już uwzględnia).
- **Zależności runtime:**
  - `satel-integra-integration-protocol`
  - standardowy `net` z Node (TCP)
  - `crypto` z Node (AES dla trybu szyfrowanego — opcjonalnie)
- **Zależności dev:** te ze szablonu (typescript, eslint, nodemon, homebridge, @types/node).

---

## 5. Struktura projektu

```
homebridge-satel-integra/
├── src/
│   ├── index.ts                  # eksport i rejestracja platformy
│   ├── settings.ts               # stałe: PLUGIN_NAME, PLATFORM_NAME
│   ├── platform.ts               # SatelPlatform — główna klasa
│   ├── satel/
│   │   ├── connection.ts         # SatelConnection — TCP, reconnect, kolejka
│   │   ├── poller.ts             # StatePoller — new_data loop, event emit
│   │   ├── commands.ts           # typed wrappery na komendy wysokiego poziomu
│   │   └── crypto.ts             # AES (opcjonalny tryb szyfrowany)
│   └── accessories/
│       ├── partitionAccessory.ts    # SecuritySystem (strefa)
│       ├── zoneAccessory.ts         # Motion / Contact / Smoke / Leak / CO / Occupancy
│       ├── shutterAccessory.ts      # WindowCovering (roleta)
│       ├── switchAccessory.ts       # Switch (przekaźnik bistabilny/impulsowy)
│       ├── lockAccessory.ts         # LockMechanism (elektrozaczep)
│       └── temperatureAccessory.ts  # TemperatureSensor (opcjonalnie)
├── test/
│   └── hbConfig/config.json      # config testowy dla nodemona
├── config.schema.json
├── package.json
├── tsconfig.json
├── nodemon.json
├── .eslintrc.json
└── README.md
```

---

## 6. `package.json` — kluczowe pola

```json
{
  "name": "homebridge-satel-integra",
  "displayName": "Satel Integra",
  "version": "0.1.0",
  "description": "Homebridge plugin for Satel Integra alarm system via ETHM-1 / ETHM-1 Plus.",
  "main": "dist/index.js",
  "engines": {
    "node": "^20 || ^22",
    "homebridge": "^1.8.0 || ^2.0.0-beta.0"
  },
  "scripts": {
    "build": "rimraf ./dist && tsc",
    "watch": "npm run build && npm link && nodemon",
    "lint": "eslint src/**.ts",
    "prepublishOnly": "npm run lint && npm run build"
  },
  "dependencies": {
    "satel-integra-integration-protocol": "^<aktualna>"
  },
  "devDependencies": "<ze szablonu>",
  "keywords": ["homebridge-plugin", "satel", "integra", "alarm", "homekit"]
}
```

---

## 7. `config.schema.json` — konfiguracja użytkownika

### 7.1 Zasady

- Pełna konfiguracja **przez UI Homebridge Config UI X** — żaden użytkownik nie ma edytować `config.json` ręcznie.
- Każde pole ma `title` (PL) i `description` wyjaśniający sens (z podpowiedzią skąd wziąć wartość — np. „numer wejścia z DLOADX").
- Tablice encji są rozwijalne (`expandable: true`), każdy wiersz pokazuje sensowną etykietę (`titleTemplate`).
- Typy czujek wybierane z listy rozwijalnej (`oneOf` albo `enum` + `titleMap`).
- Pola wrażliwe (`userCode`, `integrationKey`) oznaczone jako `"format": "password"`.

### 7.2 Schemat

```jsonc
{
  "pluginAlias": "SatelIntegra",
  "pluginType": "platform",
  "singular": true,
  "headerDisplay": "Plugin Homebridge dla centrali alarmowej **Satel Integra** (ETHM-1 / ETHM-1 Plus).",
  "footerDisplay": "Numery stref, wejść i wyjść sprawdzisz w programie **DLOADX** → *Struktura systemu*.",
  "schema": {
    "type": "object",
    "properties": {
      "name":            { "title": "Nazwa platformy", "type": "string", "default": "Satel Integra", "required": true },
      "host":            { "title": "Adres IP modułu ETHM", "type": "string", "format": "ipv4", "required": true },
      "port":            { "title": "Port TCP", "type": "integer", "default": 7094, "required": true },
      "userCode":        { "title": "Kod użytkownika Satel", "type": "string", "format": "password", "required": true,
                           "description": "Zalecane: utwórz w Satelu osobnego użytkownika z uprawnieniami tylko do potrzebnych stref i wyjść." },
      "integrationKey":  { "title": "Klucz szyfrowania (opcjonalnie, tylko ETHM-1 Plus)", "type": "string", "format": "password" },
      "pollIntervalMs":  { "title": "Interwał odpytywania (ms)", "type": "integer", "default": 1000, "minimum": 250 },

      "partitions": {
        "title": "Strefy (partycje)",
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id":           { "title": "Numer strefy w Satelu (1–32)", "type": "integer", "minimum": 1, "maximum": 32, "required": true },
            "name":         { "title": "Nazwa w HomeKit", "type": "string", "required": true },
            "armHomeMode":  { "title": "Tryb 'Home' (Stay)",  "type": "integer", "default": 2, "enum": [0,1,2,3] },
            "armNightMode": { "title": "Tryb 'Night'",        "type": "integer", "default": 3, "enum": [0,1,2,3] }
          }
        }
      },

      "zones": {
        "title": "Wejścia (czujki)",
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id":   { "title": "Numer wejścia w Satelu (1–256)", "type": "integer", "minimum": 1, "maximum": 256, "required": true },
            "name": { "title": "Nazwa w HomeKit", "type": "string", "required": true },
            "type": {
              "title": "Typ czujnika w HomeKit",
              "type": "string",
              "required": true,
              "default": "motion",
              "oneOf": [
                { "title": "Ruch (MotionSensor)",         "enum": ["motion"] },
                { "title": "Otwarcie (ContactSensor)",    "enum": ["contact"] },
                { "title": "Dym (SmokeSensor)",           "enum": ["smoke"] },
                { "title": "Zalanie (LeakSensor)",        "enum": ["leak"] },
                { "title": "Tlenek węgla (COSensor)",     "enum": ["co"] },
                { "title": "Obecność (OccupancySensor)",  "enum": ["occupancy"] }
              ]
            },
            "invert": {
              "title": "Odwróć logikę",
              "type": "boolean",
              "default": false,
              "description": "Zaznacz, gdy w Satelu wejście jest typu NC i naruszenie oznacza stan spoczynkowy."
            }
          }
        }
      },

      "shutters": {
        "title": "Rolety",
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name":          { "title": "Nazwa", "type": "string", "required": true },
            "outputUp":      { "title": "Wyjście 'góra'", "type": "integer", "minimum": 1, "maximum": 256, "required": true },
            "outputDown":    { "title": "Wyjście 'dół'",  "type": "integer", "minimum": 1, "maximum": 256, "required": true },
            "travelTimeSec": { "title": "Czas pełnego przejazdu (s)", "type": "integer", "default": 25 },
            "pulseMs":       { "title": "Długość impulsu sterującego (ms)", "type": "integer", "default": 500,
                               "description": "Ustaw 0, jeśli wyjścia są bistabilne (Satel sam zatrzymuje roletę)." }
          }
        }
      },

      "switches": {
        "title": "Przełączniki (przekaźniki)",
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name":    { "title": "Nazwa", "type": "string", "required": true },
            "output":  { "title": "Numer wyjścia w Satelu", "type": "integer", "minimum": 1, "maximum": 256, "required": true },
            "mode":    { "title": "Tryb działania", "type": "string", "default": "toggle",
                         "oneOf": [
                           { "title": "Bistabilny (ON/OFF)", "enum": ["toggle"] },
                           { "title": "Impulsowy (chwilowy ON)", "enum": ["pulse"] }
                         ]},
            "pulseMs": { "title": "Długość impulsu (ms, tylko dla trybu impulsowego)", "type": "integer", "default": 500 }
          }
        }
      },

      "locks": {
        "title": "Zamki / elektrozaczepy",
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name":    { "title": "Nazwa", "type": "string", "required": true },
            "output":  { "title": "Numer wyjścia w Satelu", "type": "integer", "minimum": 1, "maximum": 256, "required": true },
            "pulseMs": { "title": "Długość impulsu otwierającego (ms)", "type": "integer", "default": 1500 }
          }
        }
      },

      "temperatures": {
        "title": "Czujniki temperatury (opcjonalnie)",
        "type": "array",
        "description": "Wymaga wyjścia typu 'temperatura' w konfiguracji Satela.",
        "items": {
          "type": "object",
          "properties": {
            "name":   { "title": "Nazwa", "type": "string", "required": true },
            "output": { "title": "Numer wyjścia temperaturowego", "type": "integer", "minimum": 1, "maximum": 256, "required": true }
          }
        }
      }
    },
    "required": ["name", "host", "userCode"]
  },
  "layout": [
    { "type": "flex", "flex-flow": "row wrap", "items": ["host", "port"] },
    "userCode",
    { "key": "integrationKey", "condition": { "functionBody": "return model.host" } },
    { "key": "pollIntervalMs", "type": "number" },
    { "key": "partitions",   "type": "array", "expandable": true, "titleTemplate": "Strefa {{ value.id }}: {{ value.name }}" },
    { "key": "zones",        "type": "array", "expandable": true, "titleTemplate": "Wejście {{ value.id }}: {{ value.name }}" },
    { "key": "shutters",     "type": "array", "expandable": true, "titleTemplate": "Roleta: {{ value.name }}" },
    { "key": "switches",     "type": "array", "expandable": true, "titleTemplate": "Przełącznik: {{ value.name }}" },
    { "key": "locks",        "type": "array", "expandable": true, "titleTemplate": "Zamek: {{ value.name }}" },
    { "key": "temperatures", "type": "array", "expandable": true, "titleTemplate": "Temperatura: {{ value.name }}" }
  ]
}
```

### 7.3 Walidacja

Przy starcie `platform.ts` sprawdź:

- Każda tablica może być pusta lub brakująca — wtedy dany typ urządzeń po prostu nie jest tworzony.
- Jeśli wszystkie tablice są puste, `log.warn("Plugin nie ma żadnych skonfigurowanych urządzeń.")`, ale nie przerywaj startu (user może dopiero konfigurować).
- Unikalność: `id` w `partitions`, `id` w `zones`, `output` w każdej z `switches/locks/temperatures`, oraz para `(outputUp, outputDown)` w `shutters`. Duplikaty → `log.error` i pomiń duplikaty.
- Konflikty: jeśli ten sam numer wyjścia pojawi się w dwóch miejscach (np. `switch` i `shutter.outputUp`), ostrzeż — to prawie zawsze błąd konfiguracji.

---

## 8. Moduł komunikacji — `src/satel/connection.ts`

### 8.1 Wymagania

- Jedno trwałe połączenie TCP do ETHM-1.
- **Auto-reconnect** z backoffem wykładniczym (start 1 s, max 30 s).
- **Kolejka komend** (serializacja) — nie wysyłamy nowej komendy, póki nie odebraliśmy odpowiedzi lub timeouta (np. 3 s).
- Parsowanie strumienia bajtów w ramki zgodnie z `FE FE ... FE 0D` (używaj dekodera z biblioteki).
- Emisja zdarzeń (EventEmitter): `connected`, `disconnected`, `frame`, `error`.
- Opcjonalne szyfrowanie AES-192 ECB (jeśli `integrationKey` podany) — zob. `crypto.ts`.

### 8.2 Szkic interfejsu

```ts
import { EventEmitter } from 'events';
import { Socket } from 'net';

export interface SatelConnectionOptions {
  host: string;
  port: number;
  integrationKey?: string;
  commandTimeoutMs?: number; // default 3000
  reconnectMinMs?: number;   // default 1000
  reconnectMaxMs?: number;   // default 30000
  logger: LoggerLike;
}

export class SatelConnection extends EventEmitter {
  constructor(opts: SatelConnectionOptions);
  connect(): void;                               // start + auto-reconnect
  close(): void;                                 // graceful shutdown
  sendCommand(frame: Buffer): Promise<Buffer>;   // kolejkowane, z timeoutem
}
```

### 8.3 Ważne szczegóły implementacyjne

- **Bufor odbiorczy.** Dane z TCP przychodzą fragmentami — zbieraj do bufora, szukaj granicy ramki (`FE 0D` po `FE FE`), oddawaj kompletne ramki do dekodera.
- **Destuffing.** Biblioteka `satel-integra-integration-protocol` ma funkcje dekodujące — użyj ich, nie pisz CRC od nowa.
- **Szyfrowanie.** Tryb szyfrowany owija cały payload ramki. Włącza się go raz, przy nawiązaniu połączenia. Referencja: kod `satel-integra-connection` z repozytorium majektom.
- **Timeouty.** ETHM-1 potrafi się „zaciąć" — jeśli nie dostaniemy odpowiedzi w 3 s, zrywamy socket i reconnectujemy. Nie próbuj wysyłać kolejnych komend w nieskończoność.

---

## 9. Poller — `src/satel/poller.ts`

Osobna klasa, która:

1. Co `pollIntervalMs` wysyła komendę `new_data` (0x7F).
2. Parsuje bitmapę zwrotną — która kategoria danych się zmieniła.
3. Dla zmienionych kategorii wysyła szczegółową komendę. Zestaw kategorii, które nas interesują:
   - `zones_violation` (0x00) — naruszenia wejść
   - `zones_tamper` (0x01) — sabotaż wejść (opcjonalnie)
   - `zones_battery_low` (0x18) — niska bateria (opcjonalnie)
   - `partitions_armed_real` (0x0A) — stany uzbrojenia stref
   - `partitions_alarm` (0x13) — strefy z trwającym alarmem
   - `outputs_state` (0x17) — stan wyjść
   - `outputs_temperature` (jeśli dostępne) — temperatury
4. Porównuje nowy stan z poprzednim (`Map<number, boolean>` na wyjście/strefę/wejście) i emituje zdarzenia:
   - `partitionStateChanged(id, state)`
   - `outputStateChanged(id, value)`
   - `zoneViolationChanged(id, violated)`
   - `zoneTamperChanged(id, tampered)`
   - `zoneBatteryLowChanged(id, low)`
   - `alarmTriggered(partitionId)` / `alarmCleared(partitionId)`
   - `temperatureChanged(outputId, celsius)`

Akcesoria subskrybują te zdarzenia — patrz sekcja 11.

Przy (re)połączeniu poller robi **pełny odczyt** wszystkich kategorii żeby zsynchronizować stan — ignoruje `new_data` w pierwszym cyklu.

---

## 10. Komendy wysokiego poziomu — `src/satel/commands.ts`

Cienki wrapper zwracający `Promise<void>` / `Promise<State>`. Powinien ukryć konstrukcję ramki.

Minimalny zestaw:

```ts
arm(partitionIds: number[], mode: 0|1|2|3, userCode: string): Promise<void>;
disarm(partitionIds: number[], userCode: string): Promise<void>;
clearAlarm(partitionIds: number[], userCode: string): Promise<void>;

outputOn(outputIds: number[], userCode: string): Promise<void>;
outputOff(outputIds: number[], userCode: string): Promise<void>;

readPartitionsArmed(): Promise<Set<number>>;
readPartitionsAlarm(): Promise<Set<number>>;
readOutputsState(): Promise<Set<number>>;  // zbiór aktywnych wyjść
readZonesViolation(): Promise<Set<number>>;
```

Każdą z tych metod implementuj po kolei i **pisz dla nich testy jednostkowe** — porównaj bajty ramki z przykładami z dokumentacji Satela, to najłatwiejszy sposób, żeby nie zawiesić centrali.

Kod użytkownika: konwertuj string (np. `"1234"`) na 8-bajtową sekwencję BCD uzupełnioną `0xF` (np. `12 34 FF FF FF FF FF FF`). Pomocnik powinien siedzieć w `commands.ts`.

---

## 11. Platforma — `src/platform.ts`

Wzoruj się na `homebridge-plugin-template/src/platform.ts`.

### 11.1 Cykl życia

1. Konstruktor: walidacja configu (host, kod, co najmniej jedna partycja). Jeśli zły — `log.error` i `return` (nie rzucaj).
2. `api.on('didFinishLaunching')`:
   - Zestaw `SatelConnection` + `StatePoller`.
   - Dla każdej encji z configu (partycje, rolety, switches, locks) wygeneruj stabilny UUID (`api.hap.uuid.generate('satel-partition-1')` itp.) i albo odszukaj w `this.accessories` (cache), albo zarejestruj nowe.
   - Usuń z cache akcesoria, których już nie ma w configu.
   - Zainstaluj handlery zdarzeń z pollera na odpowiednie akcesoria.
3. `api.on('shutdown')`: zamknij połączenie, wyczyść timery.

### 11.2 Stabilne UUID

Klucze do generowania UUID:
- partycja: `satel:partition:${id}`
- wejście (czujka): `satel:zone:${id}`
- roleta: `satel:shutter:${outputUp}:${outputDown}`
- switch: `satel:switch:${output}`
- lock: `satel:lock:${output}`
- temperatura: `satel:temperature:${output}`

Te klucze nie mogą się zmienić między uruchomieniami — inaczej HomeKit uzna urządzenie za nowe i user zgubi automatyzacje.

---

## 12. Akcesoria — szczegóły mapowania HomeKit

### 12.1 `partitionAccessory.ts` → `SecuritySystem`

Charakterystyki:

- `SecuritySystemCurrentState`:
  - `STAY_ARM` (0) ← partycja uzbrojona w trybie równym `config.armHomeMode`
  - `AWAY_ARM` (1) ← partycja uzbrojona w trybie 0 („pełne")
  - `NIGHT_ARM` (2) ← partycja uzbrojona w trybie równym `config.armNightMode`
  - `DISARMED` (3) ← rozbrojona
  - `ALARM_TRIGGERED` (4) ← zdarzenie `partitions_alarm`

- `SecuritySystemTargetState` (co ustawia użytkownik):
  - `STAY_ARM` → `arm([id], armHomeMode, userCode)`
  - `AWAY_ARM` → `arm([id], 0, userCode)`
  - `NIGHT_ARM` → `arm([id], armNightMode, userCode)`
  - `DISARM` → `disarm([id], userCode)`

Mapowanie trybów Satel → HomeKit jest konfigurowalne przez `armHomeMode` / `armNightMode`, bo każdy instalator inaczej konfiguruje tryby 1/2/3 (pełne / dzienne / nocne). Wartości domyślne: `armHomeMode=2`, `armNightMode=3`.

Dodatkowo: jeśli trwa alarm, zwracaj `ALARM_TRIGGERED` niezależnie od stanu uzbrojenia. Przy resetowaniu alarmu stan musi wrócić do właściwego `CURRENT`.

### 12.2 `zoneAccessory.ts` → czujniki (wejścia)

Jedna klasa akcesoria z wyborem konkretnej usługi HomeKit w zależności od `config.type`:

| `config.type` | Usługa HomeKit | Charakterystyka czytana |
|---|---|---|
| `motion`     | `MotionSensor`          | `MotionDetected` (bool) |
| `contact`    | `ContactSensor`         | `ContactSensorState` (0 = zamknięty, 1 = otwarty) |
| `smoke`      | `SmokeSensor`           | `SmokeDetected` (0 = brak, 1 = wykryto) |
| `leak`       | `LeakSensor`            | `LeakDetected` (0/1) |
| `co`         | `CarbonMonoxideSensor`  | `CarbonMonoxideDetected` (0/1) |
| `occupancy`  | `OccupancySensor`       | `OccupancyDetected` (0/1) |

Logika:

1. Źródłem prawdy jest zdarzenie `zoneViolationChanged(id, violated)` z pollera (komenda `zones_violation` 0x00).
2. `violated === true` mapuje się na stan „aktywny/wykryty" we wszystkich typach. Gdy `config.invert = true`, logika jest odwrócona (dla czujek NC, gdzie spoczynek = naruszenie).
3. Opcjonalnie wystawiaj `StatusLowBattery` jeśli Satel zgłasza niski stan baterii czujki (komenda `zones_battery_low` 0x18) — pojedyncza charakterystyka wspólna dla wszystkich typów.
4. Opcjonalnie wystawiaj `StatusTampered` dla komendy `zones_tamper` 0x01.

Poller powinien te trzy kategorie (`zones_violation`, `zones_tamper`, `zones_battery_low`) odpytywać tylko, gdy `new_data` zasygnalizuje zmianę w danej kategorii — w dużym systemie (256 wejść) odpytywanie wszystkiego co sekundę byłoby obciążające.

### 12.3 `shutterAccessory.ts` → `WindowCovering`

Charakterystyki:

- `TargetPosition` (0–100, `set` z UI)
- `CurrentPosition` (0–100, tylko read)
- `PositionState` (`DECREASING=0`, `INCREASING=1`, `STOPPED=2`)

Semantyka: `0 = roleta zamknięta (na dole)`, `100 = otwarta (w górze)` — zgodnie z konwencją HomeKit.

Strategia bez odczytu rzeczywistej pozycji z Satela:

1. Zachowaj w pamięci `currentPosition` (start = 0 lub ostatnio zapamiętany po restarcie w `accessory.context`).
2. Gdy user ustawi `TargetPosition = T`:
   - Jeśli `T > current` → impuls na `outputUp` (długość `pulseMs`, albo ON/OFF dla bistabilnych).
   - Jeśli `T < current` → impuls na `outputDown`.
   - Jeśli `T == current` → nic.
3. Uruchom interwał (np. co 200 ms) aktualizujący `currentPosition` liniowo o `(200 / travelTimeSec·1000) · 100` w odpowiednią stronę, póki nie dojdzie do `T`. Wtedy `PositionState = STOPPED`.
4. **Krawędzie:** jeżeli user w trakcie ruchu zmieni cel, zatrzymaj ruch impulsem przeciwnym (opcjonalnie konfigurowalne — niektóre układy mają auto-stop) i startuj w nowym kierunku.
5. Zapisz nowy `currentPosition` do `accessory.context` po każdej zmianie — przeżyje restart.

Uwaga: to estymata. Użytkownik akceptuje, że po awarii zasilania pozycja może być rozjechana — ma wtedy ustawić 0% lub 100% ręcznie.

### 12.4 `switchAccessory.ts` → `Switch`

Tryby:

- `toggle`: `On = true` → `outputOn`, `On = false` → `outputOff`. Stan `On` aktualizowany ze zdarzeń pollera (`outputStateChanged`).
- `pulse`: `On = true` → `outputOn`, potem po `pulseMs` → `outputOff` i `On ← false` w HK. Używane np. do „chwilowego" włączenia.

Stan przełącznika bistabilnego MUSI być synchronizowany z wyjściem Satela — jeżeli ktoś przełączy je fizycznie (z klawiatury, z innego systemu) HomeKit ma to zobaczyć.

### 12.5 `lockAccessory.ts` → `LockMechanism`

Semantyka elektrozaczepu: impulsowe otwarcie, brak sprzężenia zwrotnego.

- `LockTargetState`: `UNSECURED (0)` → wyślij `outputOn`, po `pulseMs` `outputOff`, po krótkiej chwili (np. 2 s) ustaw `LockCurrentState = SECURED (1)` z powrotem.
- `LockTargetState = SECURED (1)` → nic nie rób (już jest zaryglowany).
- `LockCurrentState` startuje jako `SECURED` i wraca tam po impulsie.

### 12.6 `temperatureAccessory.ts` → `TemperatureSensor` (opcjonalne)

Jeśli w centrali skonfigurowano wyjście typu „temperatura" (np. przez moduł INT-KLCD z czujnikiem 1-Wire albo INT-E z czujnikami analogowymi), Satel udostępnia odczyt przez komendę `outputs_temperature`.

- Jedna charakterystyka: `CurrentTemperature` (°C).
- Odświeżaj po `new_data` sygnalizującym zmianę w kategorii temperatur.
- Jeśli centrala nie wspiera tej komendy (starsze Integra bez Plus), wyłącz tę sekcję i wyloguj `log.warn` zamiast wywalać plugin.

---

## 13. Logowanie i obsługa błędów

- Używaj `platform.log.debug` dla ruchu sieciowego, `log.info` dla zmian stanu (uzbrojenie/rozbrojenie), `log.warn` dla timeoutów i zerwań, `log.error` dla błędów autoryzacji i złego configu.
- **Nie loguj kodu użytkownika ani klucza szyfrowania.**
- Każdy `sendCommand` opakuj w `try/catch` — nie rzucaj wyjątków do Homebridge'a. Na błąd odpowiadaj do HomeKit przez callback z `Error`, żeby user zobaczył „Nie odpowiada" zamiast crasha wtyczki.

---

## 14. Workflow developerski

1. `git clone` szablonu, zmień nazwy (`PLATFORM_NAME = 'SatelIntegra'`, `PLUGIN_NAME = 'homebridge-satel-integra'`).
2. `npm install`.
3. Skonfiguruj `test/hbConfig/config.json` z realnym host/port/kod (nie commituj tego pliku).
4. `npm run watch` — nodemon przebuduje i zrestartuje Homebridge po każdej zmianie.
5. Po zalogowaniu pierwszego uzbrojenia/rozbrojenia ze swojej aplikacji Home sprawdź logi centrali Satel (DLOADX → pamięć zdarzeń) — powinien być wpis „Uzbrojenie od użytkownika X" z kodem, który ustawiłeś.

---

## 15. Kolejność implementacji (propozycja dla Claude Code)

Rozbij pracę na etapy, każdy w osobnym commicie. Po każdym etapie — test manualny.

1. **Szkielet pluginu** — szablon + renaming (`PLATFORM_NAME = 'SatelIntegra'`, `PLUGIN_NAME = 'homebridge-satel-integra'`), pełny `config.schema.json`, `platform.ts` logujący rozparsowaną konfigurację, bez logiki Satel. Test: config otwiera się poprawnie w UI Config UI X.
2. **`SatelConnection` bez szyfrowania** — TCP, reconnect, parsing ramek, proste API `sendCommand`. Testy jednostkowe na buforowanie i destuffing (przykładowe ramki z dokumentacji Satela).
3. **Komendy odczytu** (`readPartitionsArmed`, `readZonesViolation`, `readOutputsState`) + poller z `new_data`. W logach powinny iść zdarzenia zmian stanu przy każdej aktywności fizycznej (ruch, otwarcie drzwi, włączenie wyjścia z klawiatury).
4. **`zoneAccessory`** — najbezpieczniejszy start (tylko odczyt, żaden kod nie leci do centrali). Sprawdź wszystkie 6 typów czujników.
5. **`partitionAccessory`** — pełna obsługa `SecuritySystem` z arm/disarm. Testuj na realnej centrali, zacznij od wyjazdów (`AWAY_ARM`) z klawiatury i sprawdzaj synchronizację w obu kierunkach.
6. **`switchAccessory`** i **`lockAccessory`** — operacje na pojedynczych wyjściach.
7. **`shutterAccessory`** — estymacja pozycji, persystencja w `accessory.context`, obsługa przerwania w trakcie ruchu.
8. **`temperatureAccessory`** — tylko jeśli testowa centrala ma wyjście temperaturowe; inaczej zaślepka i komunikat `log.info`.
9. **Szyfrowanie AES-192** — opcjonalna ścieżka w `SatelConnection`.
10. **Dokumentacja** (`README.md` z przykładową konfiguracją, screenshotami z aplikacji Home, troubleshootingiem: „tylko jedno połączenie", „ETHM-1 vs Plus", „jak znaleźć numery wejść i wyjść w DLOADX").
11. **Publikacja na npm** jako `0.1.0-beta.0`. Zgłoszenie do Homebridge Verified dopiero po realnych testach na różnych rozmiarach central (najlepiej Integra 32, 64 i 128).

---

## 16. Czego **nie** robić

- Nie importuj nic z modułu `homebridge` poza typami (szablon ma to opisane jako komentarz na górze `platform.ts` — zostaw).
- Nie rób polling `outputs_state` co 100 ms — zapętlisz ETHM.
- Nie trzymaj kodu użytkownika w `accessory.context` — zostaw w pamięci platformy.
- Nie próbuj wysyłać rozbrojenia bez kodu „bo user ufa". Protokół tego nie pozwala i dobrze.
- Nie zakładaj, że Satel indexuje od 0. Indeksuje od 1.
- Nie dodawaj równolegle drugiego połączenia TCP do ETHM (np. dla „szybkich komend") — moduł tego nie obsługuje.

---

## 17. Definicja „gotowe" (MVP)

- Wszystkie typy urządzeń (strefy, czujki w 6 wariantach, rolety, switche, locki) mają działającą implementację i poprawnie pojawiają się w HomeKit na podstawie konfiguracji z UI.
- Plugin działa zarówno z konfiguracją minimalną (sama centrala, jedna strefa), jak i rozbudowaną (kilkanaście stref, kilkadziesiąt wejść, rolety, przekaźniki).
- Uzbrajanie/rozbrajanie stref z aplikacji Home działa dwukierunkowo: zmiany z klawiatury Satela są widoczne w HomeKit i odwrotnie.
- Przy wyzwoleniu alarmu (realnie lub testowo w trybie DEMO) odpowiednia strefa przełącza się na `ALARM_TRIGGERED`.
- Rolety reagują na polecenia 0% / 100% oraz pozycje pośrednie z dokładnością ± kilka procent (estymacja czasowa).
- Przełączniki (`Switch`) synchronizują stan dwukierunkowo — zmiana z klawiatury jest widoczna w HomeKit w < 2 s.
- Elektrozaczepy (`LockMechanism`) otwierają się jednym dotknięciem i wracają do stanu „zamknięty" po upływie `pulseMs + 2 s`.
- Czujki (`MotionSensor`/`ContactSensor`/…) zgłaszają naruszenia natychmiastowo (zdarzenia z `new_data`, nie pełny polling).
- Po restarcie Homebridge'a wszystkie akcesoria są odnalezione z cache, a stan aktualny w < 3 s od startu.
- Reconnect po zerwaniu połączenia z ETHM-em działa automatycznie (test: wyciągnięcie kabla Ethernet na 30 s).
- Dodanie/usunięcie urządzenia w UI pluginu bez potrzeby restartu Homebridge'a ręcznie (Config UI sam restartuje).

---

## 18. Szybka lista kontrolna dla Claude Code przed pierwszym PR-em

- [ ] `npm run build` przechodzi bez błędów i warningów.
- [ ] `npm run lint` czysto.
- [ ] Testy jednostkowe `SatelConnection` (buforowanie + parsing) są zielone.
- [ ] `config.schema.json` otwiera się w UI Homebridge bez błędów walidacji.
- [ ] W `README.md` jest co najmniej jedna przykładowa konfiguracja minimalna (1 strefa + kilka czujek) i jedna rozbudowana (wiele stref, rolet, przekaźników) — pokazujące uniwersalny charakter pluginu.
- [ ] Brak logowania sekretów.
- [ ] `engines.node` ≥ 20, `engines.homebridge` zgodne z aktualnym szablonem.

---

*Koniec specyfikacji. W razie wątpliwości: zawsze preferuj zgodność z protokołem Satela i stabilność połączenia nad elegancję API. Jeden reset ETHM-a to kilka minut, w których alarm nie komunikuje się z HomeKit — dlatego kolejka, timeouty i reconnect są ważniejsze niż „ładny" async.*
