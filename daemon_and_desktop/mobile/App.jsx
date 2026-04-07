/**
 * Sovereign Bridge — Mobile App
 * ===============================
 * Cross-platform capture & clipboard bridge.
 * 4 tabs: Capture, Notes, History, Settings.
 * VERITAS black-and-gold aesthetic.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StatusBar, StyleSheet, AppState, ActivityIndicator } from 'react-native';
import { NavigationContainer as NavContainer } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { colors, spacing } from './src/theme/veritas';
import BridgeWS from './src/services/BridgeWebSocketService';

import CaptureScreen from './src/screens/CaptureScreen';
import NotesScreen from './src/screens/NotesScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const Tab = createBottomTabNavigator();

const TabIcon = ({ label, focused }) => {
  const icons = {
    Capture: '🌉',
    Notes: '📝',
    History: '🕰',
    Settings: '⚙',
  };
  return (
    <View style={tabStyles.wrapper}>
      <Text style={[tabStyles.icon, { opacity: focused ? 1 : 0.4 }]}>
        {icons[label] || '●'}
      </Text>
      <Text style={[tabStyles.label, { color: focused ? colors.gold : colors.goldDim }]}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
};

const tabStyles = StyleSheet.create({
  wrapper: { alignItems: 'center' },
  icon: { fontSize: 20 },
  label: {
    fontFamily: 'Courier New',
    fontSize: 7,
    letterSpacing: 1,
    marginTop: 2,
  },
});

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        // Auto-connect if we have saved connection
        const saved = await BridgeWS.getSavedConnection();
        if (saved?.host) {
          await BridgeWS.connect(saved);
        }
        console.log('[BRIDGE-APP] Sovereign Bridge initialized');
      } catch (err) {
        console.error('[BRIDGE-APP] Init failed:', err);
      }
      setReady(true);
    };

    init();

    return () => {
      BridgeWS.disconnect();
    };
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.obsidian, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontFamily: 'Courier New', fontSize: 16, color: colors.gold, marginBottom: 16 }}>
          SOVEREIGN BRIDGE
        </Text>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor={colors.obsidian} />
        <NavContainer
          theme={{
            dark: true,
            colors: {
              primary: colors.gold,
              background: colors.obsidian,
              card: colors.obsidianLight,
              text: colors.text,
              border: colors.border,
              notification: colors.red,
            },
          }}
        >
          <Tab.Navigator
            screenOptions={{
              headerShown: false,
              tabBarStyle: {
                backgroundColor: colors.obsidianLight,
                borderTopWidth: 1,
                borderTopColor: colors.border,
                height: 72,
                paddingTop: 8,
                paddingBottom: 8,
              },
              tabBarShowLabel: false,
            }}
          >
            <Tab.Screen
              name="Capture"
              component={CaptureScreen}
              options={{
                tabBarIcon: ({ focused }) => <TabIcon label="Capture" focused={focused} />,
              }}
            />
            <Tab.Screen
              name="Notes"
              component={NotesScreen}
              options={{
                tabBarIcon: ({ focused }) => <TabIcon label="Notes" focused={focused} />,
              }}
            />
            <Tab.Screen
              name="History"
              component={HistoryScreen}
              options={{
                tabBarIcon: ({ focused }) => <TabIcon label="History" focused={focused} />,
              }}
            />
            <Tab.Screen
              name="Settings"
              component={SettingsScreen}
              options={{
                tabBarIcon: ({ focused }) => <TabIcon label="Settings" focused={focused} />,
              }}
            />
          </Tab.Navigator>
        </NavContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
