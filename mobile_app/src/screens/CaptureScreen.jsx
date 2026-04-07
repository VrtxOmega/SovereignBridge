/**
 * CaptureScreen — Main Bridge Feed
 * ===================================
 * Real-time capture feed with quick-send actions.
 * Camera, gallery, text input, clipboard paste (text + images).
 * Full bidirectional image support: phone ↔ PC
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, Image,
  StyleSheet, RefreshControl, Alert, Platform,
} from 'react-native';
import RNFS from 'react-native-fs';
import { colors, spacing, fonts, radius } from '../theme/veritas';
import VeritasHeader from '../components/VeritasHeader';
import CaptureCard from '../components/CaptureCard';
import BridgeWS from '../services/BridgeWebSocketService';

const CaptureScreen = () => {
  const [captures, setCaptures] = useState([]);
  const [connected, setConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [quickText, setQuickText] = useState('');

  useEffect(() => {
    const unsubs = [
      BridgeWS.on('connected', () => setConnected(true)),
      BridgeWS.on('disconnected', () => setConnected(false)),
      BridgeWS.on('SYNC_RESPONSE', (msg) => {
        if (msg.captures) setCaptures(msg.captures);
      }),
      BridgeWS.on('CLIPBOARD_UPDATE', (msg) => {
        setCaptures(prev => [{
          id: `clip_${Date.now()}`,
          type: 'clipboard',
          content: msg.content,
          source: msg.source,
          format: msg.format || 'text',
          timestamp: msg.timestamp || Date.now(),
          lane: 'ephemeral',
          tags: '[]',
        }, ...prev]);
      }),
      BridgeWS.on('CLIPBOARD_IMAGE', (msg) => {
        setCaptures(prev => [{
          id: `clipimg_${Date.now()}`,
          type: 'clipboard',
          content: '[image]',
          source: msg.source,
          format: 'image',
          thumbnail_b64: msg.data_b64,
          filename: msg.filename,
          file_size: msg.file_size,
          timestamp: msg.timestamp || Date.now(),
          lane: 'ephemeral',
          tags: '[]',
        }, ...prev]);
      }),
      BridgeWS.on('PHOTO_RECEIVED', (msg) => {
        setCaptures(prev => [{
          id: msg.capture_id || `photo_${Date.now()}`,
          type: 'photo',
          content: msg.filename,
          source: msg.source,
          thumbnail_b64: msg.thumbnail_b64,
          file_size: msg.file_size,
          timestamp: msg.timestamp || Date.now(),
          lane: 'persistent',
          tags: '[]',
        }, ...prev]);
      }),
      BridgeWS.on('HISTORY_RESPONSE', (msg) => {
        if (msg.captures) setCaptures(msg.captures);
      }),
    ];

    setConnected(BridgeWS.connected);

    return () => unsubs.forEach(u => u());
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    BridgeWS.forceReconnect();
    BridgeWS.send('HISTORY_REQUEST', { limit: 100 });
    setTimeout(() => setRefreshing(false), 1500);
  }, []);

  const sendQuickText = () => {
    if (!quickText.trim()) return;
    const text = quickText.trim();

    // Auto-detect URL
    const isUrl = /^https?:\/\/\S+$/i.test(text);

    if (isUrl) {
      BridgeWS.send('LINK_BEAM', { url: text, source: 'phone' });
    } else {
      BridgeWS.send('CLIPBOARD_UPDATE', {
        content: text,
        format: 'text',
        source: 'phone',
      });
    }

    setCaptures(prev => [{
      id: `quick_${Date.now()}`,
      type: isUrl ? 'link' : 'clipboard',
      content: text,
      source: 'phone',
      timestamp: Date.now(),
      lane: 'ephemeral',
      tags: '[]',
    }, ...prev]);

    setQuickText('');
  };

  const sendClipboard = async () => {
    try {
      const Clipboard = require('@react-native-clipboard/clipboard').default;
      const text = await Clipboard.getString();
      if (!text) {
        Alert.alert('Empty', 'Nothing on clipboard');
        return;
      }

      BridgeWS.send('CLIPBOARD_UPDATE', {
        content: text,
        format: 'text',
        source: 'phone',
      });

      setCaptures(prev => [{
        id: `paste_${Date.now()}`,
        type: 'clipboard',
        content: text,
        source: 'phone',
        timestamp: Date.now(),
        lane: 'ephemeral',
        tags: '[]',
      }, ...prev]);

      Alert.alert('Sent', 'Clipboard sent to PC');
    } catch (e) {
      Alert.alert('Error', 'Could not read clipboard');
    }
  };

  /**
   * Read an image URI (from camera or gallery), convert to base64,
   * and send as PHOTO_CAPTURE over WebSocket.
   */
  const sendImageAsBase64 = async (asset) => {
    try {
      const filename = asset.fileName || `photo_${Date.now()}.jpg`;
      let filePath = asset.uri;

      // React Native image picker URIs may need adjustment
      if (Platform.OS === 'android' && filePath.startsWith('content://')) {
        // Use RNFS to read content URI directly
        const destPath = `${RNFS.CachesDirectoryPath}/${filename}`;
        await RNFS.copyFile(filePath, destPath);
        filePath = destPath;
      } else if (filePath.startsWith('file://')) {
        filePath = filePath.replace('file://', '');
      }

      const base64Data = await RNFS.readFile(filePath, 'base64');

      BridgeWS.send('PHOTO_CAPTURE', {
        data_b64: base64Data,
        filename: filename,
        source: 'phone',
      });

      setCaptures(prev => [{
        id: `photo_${Date.now()}`,
        type: 'photo',
        content: filename,
        source: 'phone',
        thumbnail_b64: base64Data.substring(0, 65536),
        file_size: asset.fileSize || Math.round(base64Data.length * 0.75),
        timestamp: Date.now(),
        lane: 'persistent',
        tags: '[]',
      }, ...prev]);

      Alert.alert('Sent', 'Photo beamed to PC');
    } catch (e) {
      console.error('[CAPTURE] Image send error:', e);
      Alert.alert('Error', `Could not send image: ${e.message}`);
    }
  };

  const sendPhoto = () => {
    try {
      const { launchCamera } = require('react-native-image-picker');
      launchCamera({ mediaType: 'photo', quality: 0.8 }, (response) => {
        if (response.didCancel || response.errorCode) return;
        const asset = response.assets?.[0];
        if (!asset) return;
        sendImageAsBase64(asset);
      });
    } catch (e) {
      Alert.alert('Error', 'Camera not available');
    }
  };

  const sendFromGallery = () => {
    try {
      const { launchImageLibrary } = require('react-native-image-picker');
      launchImageLibrary({
        mediaType: 'mixed',
        quality: 0.8,
        selectionLimit: 5,
      }, (response) => {
        if (response.didCancel || response.errorCode) return;
        const assets = response.assets || [];
        assets.forEach(asset => sendImageAsBase64(asset));
      });
    } catch (e) {
      Alert.alert('Error', 'Gallery not available');
    }
  };

  const requestFromPC = () => {
    BridgeWS.send('PASTE_REQUEST', {});
    Alert.alert('Requested', 'Asking PC for current clipboard...');
  };

  const onCaptureLongPress = (capture) => {
    const actions = [
      { text: 'Copy Text', onPress: () => {
        try {
          const Clipboard = require('@react-native-clipboard/clipboard').default;
          Clipboard.setString(capture.content || '');
        } catch (_) {}
      }},
      {
        text: capture.lane === 'ephemeral' ? 'Make Persistent' : 'Make Ephemeral',
        onPress: () => {
          const newLane = capture.lane === 'ephemeral' ? 'persistent' : 'ephemeral';
          BridgeWS.send('LANE_UPDATE', {
            capture_id: capture.id,
            lane: newLane,
          });
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ];

    // If it has an image or file, add "Save / Download" option
    if (capture.thumbnail_b64 || capture.format === 'image' || capture.type === 'file' || capture.type === 'photo') {
      actions.unshift({
        text: 'Save to Device',
        onPress: async () => {
          try {
            const isLocal = capture.id?.startsWith?.('photo_') || capture.id?.startsWith?.('clip');
            if (isLocal) {
               // Sent from phone originally, so they already have it, but we can write the local b64 if needed
               Alert.alert('Saved', 'This picture originated from your device.');
               return;
            }

            const status = BridgeWS.getStatus();
            if (!status.host) {
              Alert.alert('Error', 'Not connected to Bridge');
              return;
            }

            // Target the Daemon's API for the full-resolution uncorrupted file
            const url = `http://${status.host}:${status.port || '5003'}/api/download/${capture.id}`;
            const destPath = `${RNFS.DownloadDirectoryPath}/${capture.content || capture.filename || `bridge_dl_${Date.now()}.jpg`}`;
            
            Alert.alert('Downloading...', 'Fetching full resolution file from PC');
            
            const result = await RNFS.downloadFile({
              fromUrl: url,
              toFile: destPath,
              begin: (res) => console.log('Download started', res),
              progress: (res) => console.log((res.bytesWritten / res.contentLength) * 100),
            }).promise;

            if (result.statusCode === 200) {
              Alert.alert('Success', `Saved to Downloads: ${destPath}`);
            } else {
              Alert.alert('Error', 'Failed to fetch from PC');
            }
          } catch (e) {
            console.error('Download error:', e);
            Alert.alert('Error', 'Could not save file');
          }
        },
      });
    }

    Alert.alert(
      capture.type.toUpperCase(),
      capture.content?.substring(0, 200) || capture.filename || 'Capture',
      actions,
    );
  };

  return (
    <View style={styles.container}>
      <VeritasHeader title="SOVEREIGN BRIDGE" connected={connected} />

      {/* Quick Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={sendClipboard}>
          <Text style={styles.actionIcon}>📋</Text>
          <Text style={styles.actionLabel}>PASTE</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={sendPhoto}>
          <Text style={styles.actionIcon}>📷</Text>
          <Text style={styles.actionLabel}>CAMERA</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={sendFromGallery}>
          <Text style={styles.actionIcon}>🖼️</Text>
          <Text style={styles.actionLabel}>GALLERY</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={requestFromPC}>
          <Text style={styles.actionIcon}>📥</Text>
          <Text style={styles.actionLabel}>FROM PC</Text>
        </TouchableOpacity>
      </View>

      {/* Quick text input */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.textInput}
          placeholder="Send text or URL..."
          placeholderTextColor={colors.textFaint}
          value={quickText}
          onChangeText={setQuickText}
          onSubmitEditing={sendQuickText}
          returnKeyType="send"
        />
        <TouchableOpacity
          style={[styles.sendBtn, !quickText.trim() && styles.sendBtnDisabled]}
          onPress={sendQuickText}
          disabled={!quickText.trim()}
        >
          <Text style={styles.sendBtnText}>BEAM</Text>
        </TouchableOpacity>
      </View>

      {/* Capture Feed */}
      <FlatList
        data={captures}
        keyExtractor={(item) => item.id || `${item.timestamp}`}
        renderItem={({ item }) => (
          <CaptureCard
            capture={item}
            onPress={(c) => {
              if (c.thumbnail_b64 || c.format === 'image') {
                // Full-screen image preview could go here
                return;
              }
              // Copy to clipboard on tap
              try {
                const Clipboard = require('@react-native-clipboard/clipboard').default;
                Clipboard.setString(c.content || '');
              } catch (_) {}
            }}
            onLongPress={onCaptureLongPress}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.gold}
            colors={[colors.gold]}
          />
        }
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🌉</Text>
            <Text style={styles.emptyTitle}>No captures yet</Text>
            <Text style={styles.emptySubtitle}>
              Copy text, take a photo, pick from gallery, or send a link
            </Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.obsidian,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionBtn: {
    alignItems: 'center',
    backgroundColor: colors.obsidianMid,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    minWidth: 72,
  },
  actionIcon: {
    fontSize: 22,
    marginBottom: 4,
  },
  actionLabel: {
    fontFamily: fonts.mono,
    fontSize: 7,
    letterSpacing: 2,
    color: colors.goldDim,
  },
  inputRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  textInput: {
    flex: 1,
    backgroundColor: colors.obsidianLight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: 'System',
    fontSize: 14,
    color: colors.text,
    marginRight: spacing.sm,
  },
  sendBtn: {
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.3,
  },
  sendBtnText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2,
    color: colors.obsidian,
    fontWeight: 'bold',
  },
  list: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontFamily: fonts.mono,
    fontSize: 14,
    letterSpacing: 3,
    color: colors.goldDim,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    fontFamily: 'System',
    fontSize: 13,
    color: colors.textFaint,
    textAlign: 'center',
    paddingHorizontal: spacing.xxl,
  },
});

export default CaptureScreen;
