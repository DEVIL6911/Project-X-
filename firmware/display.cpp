/*
 * JARVIS Buddy Robot — Display Implementation
 * ==============================================
 * ST7735 1.8" SPI TFT (128×160 pixels) emotion face renderer.
 *
 * Each emotion has:
 *   - A unique background RGB color gradient
 *   - Distinct eye shapes (circles, hearts, stars, etc.)
 *   - Mouth expression (arc, line, zigzag, etc.)
 *   - Animation (blink, bounce, pulse, shake, etc.)
 *
 * The display task calls displayRenderFrame() at 10Hz.
 * A SPI mutex prevents bus collisions with other SPI devices.
 */

#include "display.h"
#include "config.h"
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <SPI.h>

// Screen dimensions
#define SCREEN_W 128
#define SCREEN_H 160

// Face geometry — centered on screen
#define FACE_CX  64    // Center X
#define FACE_CY  70    // Center Y (slightly above center for message area below)
#define EYE_Y    55    // Eye vertical position
#define EYE_LX   42    // Left eye X
#define EYE_RX   86    // Right eye X
#define MOUTH_Y  90    // Mouth vertical position

// Display instance — using hardware SPI
static Adafruit_ST7735 tft = Adafruit_ST7735(TFT_CS, TFT_DC, TFT_RST);

// SPI mutex — shared across all SPI peripherals
static SemaphoreHandle_t _spiMutex = NULL;

// Current state
static Emotion _currentEmotion = EMO_IDLE;
static Emotion _prevEmotion = EMO_COUNT; // Force initial render
static uint32_t _frameCount = 0;
static char _message[32] = "";

// ---------------------------------------------------------------------------
// Color palette for each emotion (RGB565 format)
// ---------------------------------------------------------------------------
struct EmotionTheme {
    uint16_t bgColor;
    uint16_t eyeColor;
    uint16_t mouthColor;
    uint16_t accentColor;
};

// Helper: Convert 8-bit RGB to RGB565
static uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) {
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

static const EmotionTheme themes[EMO_COUNT] = {
    /* IDLE      */ {rgb(20, 30, 48),    rgb(79, 195, 247),  rgb(79, 195, 247),  rgb(41, 98, 128)},
    /* HAPPY     */ {rgb(20, 40, 25),    rgb(102, 187, 106), rgb(102, 187, 106), rgb(56, 142, 60)},
    /* SAD       */ {rgb(28, 20, 48),    rgb(126, 87, 194),  rgb(126, 87, 194),  rgb(81, 45, 168)},
    /* THINKING  */ {rgb(40, 30, 15),    rgb(255, 167, 38),  rgb(255, 167, 38),  rgb(210, 105, 0)},
    /* ALERT     */ {rgb(50, 15, 15),    rgb(239, 83, 80),   rgb(239, 83, 80),   rgb(198, 40, 40)},
    /* LISTENING */ {rgb(15, 35, 50),    rgb(41, 182, 246),  rgb(41, 182, 246),  rgb(2, 119, 189)},
    /* SLEEPING  */ {rgb(25, 30, 35),    rgb(120, 144, 156), rgb(120, 144, 156), rgb(69, 90, 100)},
    /* EXCITED   */ {rgb(50, 48, 10),    rgb(255, 238, 88),  rgb(255, 238, 88),  rgb(249, 168, 37)},
    /* CONFUSED  */ {rgb(45, 25, 15),    rgb(255, 112, 67),  rgb(255, 112, 67),  rgb(216, 67, 21)},
    /* ANGRY     */ {rgb(55, 10, 10),    rgb(244, 67, 54),   rgb(244, 67, 54),   rgb(183, 28, 28)},
    /* SHY       */ {rgb(48, 25, 35),    rgb(244, 143, 177), rgb(244, 143, 177), rgb(194, 24, 91)},
    /* LOVE      */ {rgb(50, 15, 30),    rgb(236, 64, 122),  rgb(236, 64, 122),  rgb(173, 20, 87)},
    /* SURPRISED */ {rgb(35, 20, 48),    rgb(171, 71, 188),  rgb(171, 71, 188),  rgb(123, 31, 162)},
    /* BORED     */ {rgb(35, 28, 22),    rgb(141, 110, 99),  rgb(141, 110, 99),  rgb(93, 64, 55)},
};


// ---------------------------------------------------------------------------
// Eye renderers — each emotion has a unique eye style
// ---------------------------------------------------------------------------
static void _drawCircleEyes(uint16_t color, int radius) {
    tft.fillCircle(EYE_LX, EYE_Y, radius, color);
    tft.fillCircle(EYE_RX, EYE_Y, radius, color);
}

static void _drawBlinkEyes(uint16_t color) {
    // Horizontal lines for blinking
    tft.fillRect(EYE_LX - 8, EYE_Y - 1, 16, 3, color);
    tft.fillRect(EYE_RX - 8, EYE_Y - 1, 16, 3, color);
}

static void _drawHeartEyes(uint16_t color) {
    // Simplified heart shape using two circles and a triangle
    for (int side = 0; side < 2; side++) {
        int cx = side == 0 ? EYE_LX : EYE_RX;
        tft.fillCircle(cx - 4, EYE_Y - 3, 5, color);
        tft.fillCircle(cx + 4, EYE_Y - 3, 5, color);
        tft.fillTriangle(cx - 9, EYE_Y - 1, cx + 9, EYE_Y - 1, cx, EYE_Y + 8, color);
    }
}

static void _drawStarEyes(uint16_t color) {
    // Simplified star using lines from center
    for (int side = 0; side < 2; side++) {
        int cx = side == 0 ? EYE_LX : EYE_RX;
        for (int i = 0; i < 5; i++) {
            float angle = i * 72.0 * PI / 180.0 - PI / 2;
            int x2 = cx + cos(angle) * 8;
            int y2 = EYE_Y + sin(angle) * 8;
            tft.drawLine(cx, EYE_Y, x2, y2, color);
        }
        tft.fillCircle(cx, EYE_Y, 3, color);
    }
}

static void _drawAngryEyes(uint16_t color) {
    // Angled "V" eyebrows with dots
    tft.fillCircle(EYE_LX, EYE_Y, 6, color);
    tft.fillCircle(EYE_RX, EYE_Y, 6, color);
    tft.drawLine(EYE_LX - 8, EYE_Y - 10, EYE_LX + 5, EYE_Y - 5, color);
    tft.drawLine(EYE_RX + 8, EYE_Y - 10, EYE_RX - 5, EYE_Y - 5, color);
}

static void _drawSleepyEyes(uint16_t color) {
    // Curved closed eyes
    for (int i = -8; i <= 8; i++) {
        int y = EYE_Y + abs(i) / 3;
        tft.drawPixel(EYE_LX + i, y, color);
        tft.drawPixel(EYE_RX + i, y, color);
    }
}

static void _drawBigEyes(uint16_t color) {
    // Large circles for surprise
    tft.fillCircle(EYE_LX, EYE_Y, 10, color);
    tft.fillCircle(EYE_RX, EYE_Y, 10, color);
    tft.fillCircle(EYE_LX, EYE_Y, 5, themes[_currentEmotion].bgColor);
    tft.fillCircle(EYE_RX, EYE_Y, 5, themes[_currentEmotion].bgColor);
}

static void _drawShyEyes(uint16_t color) {
    // Small, looking down-right
    tft.fillCircle(EYE_LX + 3, EYE_Y + 2, 5, color);
    tft.fillCircle(EYE_RX + 3, EYE_Y + 2, 5, color);
}

static void _drawConfusedEyes(uint16_t color) {
    // Different sizes
    tft.fillCircle(EYE_LX, EYE_Y, 8, color);
    tft.fillCircle(EYE_RX, EYE_Y, 5, color);
}

static void _drawHalfLiddedEyes(uint16_t color) {
    // Half-closed for boredom
    tft.fillCircle(EYE_LX, EYE_Y, 7, color);
    tft.fillCircle(EYE_RX, EYE_Y, 7, color);
    // Cover top half with background
    tft.fillRect(EYE_LX - 8, EYE_Y - 8, 16, 8, themes[_currentEmotion].bgColor);
    tft.fillRect(EYE_RX - 8, EYE_Y - 8, 16, 8, themes[_currentEmotion].bgColor);
}


// ---------------------------------------------------------------------------
// Mouth renderers
// ---------------------------------------------------------------------------
static void _drawSmile(uint16_t color) {
    // Upward arc
    for (int i = -15; i <= 15; i++) {
        int y = MOUTH_Y + (i * i) / 30;
        tft.drawPixel(FACE_CX + i, y, color);
        tft.drawPixel(FACE_CX + i, y + 1, color);
    }
}

static void _drawFrown(uint16_t color) {
    // Downward arc
    for (int i = -15; i <= 15; i++) {
        int y = MOUTH_Y + 5 - (i * i) / 30;
        tft.drawPixel(FACE_CX + i, y, color);
        tft.drawPixel(FACE_CX + i, y + 1, color);
    }
}

static void _drawFlatMouth(uint16_t color) {
    tft.fillRect(FACE_CX - 12, MOUTH_Y, 24, 2, color);
}

static void _drawOpenMouth(uint16_t color) {
    tft.fillCircle(FACE_CX, MOUTH_Y + 3, 8, color);
    tft.fillCircle(FACE_CX, MOUTH_Y + 3, 4, themes[_currentEmotion].bgColor);
}

static void _drawWideGrin(uint16_t color) {
    _drawSmile(color);
    tft.fillRect(FACE_CX - 10, MOUTH_Y - 1, 20, 2, color);
}

static void _drawJaggedMouth(uint16_t color) {
    // Zigzag angry mouth
    for (int i = 0; i < 5; i++) {
        int x = FACE_CX - 15 + i * 7;
        int y1 = MOUTH_Y + (i % 2 == 0 ? 0 : 5);
        int y2 = MOUTH_Y + (i % 2 == 0 ? 5 : 0);
        tft.drawLine(x, y1, x + 7, y2, color);
    }
}

static void _drawSquiggle(uint16_t color) {
    // Wavy confused mouth
    for (int i = -15; i <= 15; i++) {
        int y = MOUTH_Y + sin(i * 0.5) * 3;
        tft.drawPixel(FACE_CX + i, y, color);
        tft.drawPixel(FACE_CX + i, y + 1, color);
    }
}


// ---------------------------------------------------------------------------
// Animation helpers
// ---------------------------------------------------------------------------
static void _drawThinkingDots(uint16_t color) {
    // Three dots that cycle: . .. ...
    int numDots = (_frameCount / 5) % 4;  // 0-3 dots cycling
    for (int i = 0; i < numDots && i < 3; i++) {
        tft.fillCircle(FACE_CX - 10 + i * 10, MOUTH_Y + 15, 3, color);
    }
}

static void _drawListeningRings(uint16_t color) {
    // Expanding concentric rings
    int radius = (_frameCount * 2) % 30 + 5;
    tft.drawCircle(FACE_CX, MOUTH_Y + 10, radius, color);
    if (radius > 10) {
        tft.drawCircle(FACE_CX, MOUTH_Y + 10, radius - 10, color);
    }
}

static void _drawFloatingZ(uint16_t color) {
    // Floating "Z" for sleeping
    int yOff = -((_frameCount * 2) % 20);
    tft.setCursor(FACE_CX + 15, EYE_Y - 15 + yOff);
    tft.setTextColor(color);
    tft.setTextSize(1);
    tft.print("Z");
    tft.setCursor(FACE_CX + 22, EYE_Y - 25 + yOff);
    tft.print("z");
}

static void _drawFloatingHearts(uint16_t color) {
    // Tiny hearts floating up
    int yOff = -((_frameCount * 3) % 25);
    int xOff = sin(_frameCount * 0.3) * 8;
    tft.setCursor(FACE_CX + 20 + xOff, EYE_Y - 20 + yOff);
    tft.setTextColor(color);
    tft.setTextSize(1);
    tft.print("<3");
}


// ---------------------------------------------------------------------------
// Main render function — called by display task at 10Hz
// ---------------------------------------------------------------------------
void displayRenderFrame() {
    if (_spiMutex == NULL) return;
    if (xSemaphoreTake(_spiMutex, pdMS_TO_TICKS(50)) != pdTRUE) return;

    const EmotionTheme& theme = themes[_currentEmotion];
    bool fullRedraw = (_currentEmotion != _prevEmotion);

    if (fullRedraw) {
        tft.fillScreen(theme.bgColor);
        _prevEmotion = _currentEmotion;
    }

    // Apply per-frame animation by clearing the face area only
    if (!fullRedraw) {
        tft.fillRect(0, EYE_Y - 20, SCREEN_W, MOUTH_Y - EYE_Y + 40, theme.bgColor);
    }

    // Calculate animation offsets
    int bounceY = 0;
    int shakeX = 0;

    switch (_currentEmotion) {
        case EMO_EXCITED:
            bounceY = sin(_frameCount * 0.8) * 3;
            break;
        case EMO_ANGRY:
            shakeX = (_frameCount % 4 < 2) ? 2 : -2;
            break;
        case EMO_HAPPY:
            bounceY = sin(_frameCount * 0.3) * 1;
            break;
        default:
            break;
    }

    // Blink animation — every ~3 seconds (30 frames), show blink for 2 frames
    bool isBlinking = (_frameCount % 30 < 2) &&
                      (_currentEmotion != EMO_SLEEPING) &&
                      (_currentEmotion != EMO_ANGRY);

    // Render eyes
    if (isBlinking) {
        _drawBlinkEyes(theme.eyeColor);
    } else {
        switch (_currentEmotion) {
            case EMO_IDLE:
            case EMO_LISTENING:
                _drawCircleEyes(theme.eyeColor, 7);
                break;
            case EMO_HAPPY:
            case EMO_EXCITED:
                _drawCircleEyes(theme.eyeColor, 8);
                break;
            case EMO_SAD:
                _drawSleepyEyes(theme.eyeColor);
                break;
            case EMO_THINKING:
                // One eye squinted, one normal
                tft.fillCircle(EYE_LX, EYE_Y, 7, theme.eyeColor);
                _drawBlinkEyes(theme.eyeColor);  // Right eye squinted
                tft.fillCircle(EYE_LX, EYE_Y, 7, theme.eyeColor);  // Restore left
                break;
            case EMO_ALERT:
                // Diamond-shaped eyes
                tft.fillTriangle(EYE_LX, EYE_Y-8, EYE_LX-6, EYE_Y, EYE_LX, EYE_Y+8, theme.eyeColor);
                tft.fillTriangle(EYE_LX, EYE_Y-8, EYE_LX+6, EYE_Y, EYE_LX, EYE_Y+8, theme.eyeColor);
                tft.fillTriangle(EYE_RX, EYE_Y-8, EYE_RX-6, EYE_Y, EYE_RX, EYE_Y+8, theme.eyeColor);
                tft.fillTriangle(EYE_RX, EYE_Y-8, EYE_RX+6, EYE_Y, EYE_RX, EYE_Y+8, theme.eyeColor);
                break;
            case EMO_SLEEPING:
                _drawSleepyEyes(theme.eyeColor);
                break;
            case EMO_CONFUSED:
                _drawConfusedEyes(theme.eyeColor);
                break;
            case EMO_ANGRY:
                _drawAngryEyes(theme.eyeColor);
                break;
            case EMO_SHY:
                _drawShyEyes(theme.eyeColor);
                break;
            case EMO_LOVE:
                _drawHeartEyes(theme.eyeColor);
                break;
            case EMO_SURPRISED:
                _drawBigEyes(theme.eyeColor);
                break;
            case EMO_BORED:
                _drawHalfLiddedEyes(theme.eyeColor);
                break;
            default:
                _drawCircleEyes(theme.eyeColor, 7);
                break;
        }
    }

    // Render mouth
    switch (_currentEmotion) {
        case EMO_IDLE:
            _drawFlatMouth(theme.mouthColor);
            break;
        case EMO_HAPPY:
        case EMO_SHY:
            _drawSmile(theme.mouthColor);
            break;
        case EMO_SAD:
            _drawFrown(theme.mouthColor);
            break;
        case EMO_THINKING:
            _drawSquiggle(theme.mouthColor);
            break;
        case EMO_ALERT:
        case EMO_SURPRISED:
            _drawOpenMouth(theme.mouthColor);
            break;
        case EMO_LISTENING:
            _drawFlatMouth(theme.mouthColor);
            break;
        case EMO_SLEEPING:
            _drawFlatMouth(theme.mouthColor);
            break;
        case EMO_EXCITED:
            _drawWideGrin(theme.mouthColor);
            break;
        case EMO_CONFUSED:
            _drawSquiggle(theme.mouthColor);
            break;
        case EMO_ANGRY:
            _drawJaggedMouth(theme.mouthColor);
            break;
        case EMO_LOVE:
            _drawSmile(theme.mouthColor);
            break;
        case EMO_BORED:
            _drawOpenMouth(theme.mouthColor);
            break;
        default:
            _drawFlatMouth(theme.mouthColor);
            break;
    }

    // Render special animations
    switch (_currentEmotion) {
        case EMO_THINKING:
            _drawThinkingDots(theme.accentColor);
            break;
        case EMO_LISTENING:
            _drawListeningRings(theme.accentColor);
            break;
        case EMO_SLEEPING:
            _drawFloatingZ(theme.accentColor);
            break;
        case EMO_LOVE:
            _drawFloatingHearts(theme.accentColor);
            break;
        case EMO_ALERT:
            // Flashing border
            if (_frameCount % 6 < 3) {
                tft.drawRect(0, 0, SCREEN_W, SCREEN_H, theme.eyeColor);
                tft.drawRect(1, 1, SCREEN_W - 2, SCREEN_H - 2, theme.eyeColor);
            }
            break;
        default:
            break;
    }

    // Render message text at the bottom
    if (_message[0] != '\0') {
        tft.fillRect(0, SCREEN_H - 20, SCREEN_W, 20, rgb(0, 0, 0));
        tft.setCursor(4, SCREEN_H - 16);
        tft.setTextColor(rgb(200, 200, 200));
        tft.setTextSize(1);
        tft.print(_message);
    }

    _frameCount++;
    xSemaphoreGive(_spiMutex);
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
void displayInit() {
    _spiMutex = xSemaphoreCreateMutex();

    tft.initR(INITR_BLACKTAB);
    tft.setRotation(0);
    tft.fillScreen(themes[EMO_IDLE].bgColor);
    tft.setTextWrap(false);

    Serial.println("[DISPLAY] ST7735 initialized (128x160)");
}


void displaySetEmotion(Emotion emotion) {
    if (emotion >= EMO_COUNT) emotion = EMO_IDLE;
    _currentEmotion = emotion;
}


Emotion displayGetEmotion() {
    return _currentEmotion;
}


void displaySetMessage(const char* msg) {
    strncpy(_message, msg, sizeof(_message) - 1);
    _message[sizeof(_message) - 1] = '\0';
}


Emotion displayParseEmotion(const char* emotionStr) {
    if (!emotionStr) return EMO_IDLE;

    if (strcmp(emotionStr, "IDLE") == 0)      return EMO_IDLE;
    if (strcmp(emotionStr, "HAPPY") == 0)     return EMO_HAPPY;
    if (strcmp(emotionStr, "SAD") == 0)       return EMO_SAD;
    if (strcmp(emotionStr, "THINKING") == 0)  return EMO_THINKING;
    if (strcmp(emotionStr, "ALERT") == 0)     return EMO_ALERT;
    if (strcmp(emotionStr, "LISTENING") == 0) return EMO_LISTENING;
    if (strcmp(emotionStr, "SLEEPING") == 0)  return EMO_SLEEPING;
    if (strcmp(emotionStr, "EXCITED") == 0)   return EMO_EXCITED;
    if (strcmp(emotionStr, "CONFUSED") == 0)  return EMO_CONFUSED;
    if (strcmp(emotionStr, "ANGRY") == 0)     return EMO_ANGRY;
    if (strcmp(emotionStr, "SHY") == 0)       return EMO_SHY;
    if (strcmp(emotionStr, "LOVE") == 0)      return EMO_LOVE;
    if (strcmp(emotionStr, "SURPRISED") == 0) return EMO_SURPRISED;
    if (strcmp(emotionStr, "BORED") == 0)     return EMO_BORED;

    return EMO_IDLE;
}
