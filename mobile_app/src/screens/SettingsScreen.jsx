/**
 * SettingsScreen — Connection Config & QR Scanner
 * ==================================================
 * Manual IP/URL entry, QR code scanning for pairing,
 * connection status, preferences.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Switch,
  StyleSheet, ScrollView, Alert, Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, fonts, radius } from '../theme/veritas';
import VeritasHeader from '../components/VeritasHeader';
import BridgeWS from '../services/BridgeWebSocketService';

const SettingsScreen = () => {
  const [connected, setConnected] = useState(false);
  const [hostInput, setHostInput] = useState('');
  const [status, setStatus] = useState({});
  const [clipSync, setClipSync] = useState(true);
  const [defaultLane, setDefaultLane] = useState('ephemeral');

  useEffect(() => {
    const unsubs = [
      BridgeWS.on('connected', () => {
        setConnected(true);
        setStatus(BridgeWS.getStatus());
      }),
      BridgeWS.on('disconnected', () => {
        setConnected(false);
        setStatus(BridgeWS.getStatus());
      }),
    ];

    setConnected(BridgeWS.connected);
    setStatus(BridgeWS.getStatus());

    loadSettings();

    return () => unsubs.forEach(u => u());
  }, []);

  const loadSettings = async () => {
    const lane = await AsyncStorage.getItem('bridge_default_lane');
    if (lane) setDefaultLane(lane);
    const clip = await AsyncStorage.getItem('bridge_clip_sync');
    if (clip !== null) setClipSync(clip === 'true');
    const saved = await BridgeWS.getSavedConnection();
    if (saved?.host) setHostInput(saved.host);
  };

  const connect = () => {
    if (!hostInput.trim()) {
      Alert.alert('Error', 'Enter a host address or tunnel URL');
      return;
    }

    const host = hostInput.trim();
    BridgeWS.connect({ host, port: '' });
    Alert.alert('Connecting', `Connecting to ${host}...`);
  };

  const useTunnel = () => {
    const host = 'sovereign-bridge-vrts.loca.lt';
    setHostInput(host);
    BridgeWS.connect({ host, port: '' });
    Alert.alert('Tunnel', 'Using Sovereign Tunnel');
  };

  const disconnect = () => {
    Alert.alert('Disconnect', 'Unpair from this PC?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          BridgeWS.disconnect();
          await BridgeWS.clearSavedConnection();
          setHostInput('');
          setConnected(false);
        },
      },
    ]);
  };

  const toggleLane = async (val) => {
    const lane = val ? 'persistent' : 'ephemeral';
    setDefaultLane(lane);
    await AsyncStorage.setItem('bridge_default_lane', lane);
  };

  const toggleClipSync = async (val) => {
    setClipSync(val);
    await AsyncStorage.setItem('bridge_clip_sync', String(val));
  };

  const autoPair = async () => {
    const directHost = '192.168.1.16';
    setHostInput(directHost);
    BridgeWS.connect({ host: directHost, port: '5003' });
  };

  return (
    <View style={styles.container}>
      <VeritasHeader
        title="SOVEREIGN BRIDGE"
        subtitle="SETTINGS"
        connected={connected}
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Connection Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>CONNECTION</Text>

          <View style={styles.statusCard}>
            <View style={styles.statusRow}>
              <View style={[
                styles.statusDot,
                { backgroundColor: connected ? colors.green : colors.red }
              ]} />
              <Text style={styles.statusText}>
                {connected ? 'CONNECTED' : 'DISCONNECTED'}
              </Text>
            </View>
            {status.host && (
              <Text style={styles.statusDetail}>Host: {status.host}</Text>
            )}
            {status.reconnectAttempts > 0 && (
              <Text style={styles.statusDetail}>
                Reconnect attempts: {status.reconnectAttempts}
              </Text>
            )}
          </View>
        </View>

        {/* Connection Config */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PAIRING</Text>

          <TextInput
            style={styles.input}
            value={hostInput}
            onChangeText={setHostInput}
            placeholder="PC IP or tunnel URL"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.primaryBtn} onPress={connect}>
              <Text style={styles.primaryBtnText}>CONNECT</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={useTunnel}>
              <Text style={styles.secondaryBtnText}>USE TUNNEL</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.qrBtn} onPress={autoPair}>
            <Text style={styles.qrBtnIcon}>🔗</Text>
            <Text style={styles.qrBtnText}>1-CLICK AUTO PAIR</Text>
          </TouchableOpacity>

          {connected && (
            <TouchableOpacity style={styles.disconnectBtn} onPress={disconnect}>
              <Text style={styles.disconnectBtnText}>DISCONNECT</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Preferences */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PREFERENCES</Text>

          <View style={styles.settingRow}>
            <View>
              <Text style={styles.settingLabel}>Clipboard Sync</Text>
              <Text style={styles.settingDesc}>
                Receive PC clipboard changes
              </Text>
            </View>
            <Switch
              value={clipSync}
              onValueChange={toggleClipSync}
              trackColor={{ true: colors.gold, false: colors.obsidianMid }}
              thumbColor={colors.white}
            />
          </View>

          <View style={styles.settingRow}>
            <View>
              <Text style={styles.settingLabel}>Default Lane</Text>
              <Text style={styles.settingDesc}>
                {defaultLane === 'persistent'
                  ? 'Captures kept permanently'
                  : 'Captures auto-clear after 24h'}
              </Text>
            </View>
            <Switch
              value={defaultLane === 'persistent'}
              onValueChange={toggleLane}
              trackColor={{ true: colors.gold, false: colors.obsidianMid }}
              thumbColor={colors.white}
            />
          </View>
        </View>

        {/* About */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ABOUT</Text>
          <View style={styles.aboutCard}>
            <Text style={styles.aboutLogo}>V</Text>
            <Text style={styles.aboutName}>SOVEREIGN BRIDGE</Text>
            <Text style={styles.aboutVersion}>v1.0.0</Text>
            <Text style={styles.aboutMotto}>
              Examina omnia, venerare nihil, pro te cogita
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.obsidian,
  },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  section: {
    marginBottom: spacing.xxl,
  },
  sectionTitle: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 3,
    color: colors.goldDim,
    marginBottom: spacing.md,
  },
  statusCard: {
    backgroundColor: colors.obsidianLight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: spacing.sm,
  },
  statusText: {
    fontFamily: fonts.mono,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.text,
  },
  statusDetail: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.textDim,
    marginTop: 2,
    marginLeft: 18,
  },
  input: {
    backgroundColor: colors.obsidianLight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.text,
    marginBottom: spacing.md,
  },
  btnRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.obsidian,
    fontWeight: 'bold',
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: colors.obsidianLight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gold,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.gold,
  },
  qrBtn: {
    backgroundColor: colors.goldGlow,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  qrBtnIcon: {
    fontSize: 20,
    marginRight: spacing.sm,
  },
  qrBtnText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.gold,
  },
  disconnectBtn: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.red,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  disconnectBtnText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.red,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.obsidianLight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  settingLabel: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.text,
    letterSpacing: 1,
  },
  settingDesc: {
    fontFamily: 'System',
    fontSize: 11,
    color: colors.textDim,
    marginTop: 2,
  },
  aboutCard: {
    backgroundColor: colors.obsidianLight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
  },
  aboutLogo: {
    fontFamily: fonts.mono,
    fontSize: 32,
    color: colors.gold,
    fontWeight: 'bold',
    marginBottom: spacing.sm,
  },
  aboutName: {
    fontFamily: fonts.mono,
    fontSize: 13,
    letterSpacing: 4,
    color: colors.gold,
    marginBottom: spacing.xs,
  },
  aboutVersion: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.textDim,
    marginBottom: spacing.md,
  },
  aboutMotto: {
    fontFamily: fonts.mono,
    fontSize: 8,
    letterSpacing: 1,
    color: colors.textFaint,
    fontStyle: 'italic',
    textAlign: 'center',
  },
});

export default SettingsScreen;
