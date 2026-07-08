/*
 * JARVIS Buddy Robot — Display Header
 * =====================================
 * ST7735 1.8" SPI TFT emotion face renderer.
 * 14 emotion states with distinct RGB palettes and animations.
 */

#ifndef DISPLAY_H
#define DISPLAY_H

#include <Arduino.h>
#include "config.h"

// Initialize the ST7735 display and SPI mutex
void displayInit();

// Set the current emotion state — the display task renders it
void displaySetEmotion(Emotion emotion);

// Get the current emotion state
Emotion displayGetEmotion();

// Render one frame of the current emotion animation
// Called by the display FreeRTOS task at 10Hz
void displayRenderFrame();

// Display a text message on the bottom of the screen
void displaySetMessage(const char* msg);

// Convert emotion string (from backend JSON) to Emotion enum
Emotion displayParseEmotion(const char* emotionStr);

#endif // DISPLAY_H
