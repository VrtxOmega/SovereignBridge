/**
 * HistoryScreen — Capture Timeline
 * ===================================
 * Chronological list of all captures with filters.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl, TextInput,
} from 'react-native';
import { colors, spacing, fonts, radius } from '../theme/veritas';
import VeritasHeader from '../components/VeritasHeader';
import CaptureCard from '../components/CaptureCard';
import BridgeWS from '../services/BridgeWebSocketService';

const FILTER_TYPES = ['all', 'clipboard', 'photo', 'file', 'link', 'voice', 'note'];

const HistoryScreen = () => {
  const [captures, setCaptures] = useState([]);
  const [connected, setConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const unsubs = [
      BridgeWS.on('connected', () => setConnected(true)),
      BridgeWS.on('disconnected', () => setConnected(false)),
      BridgeWS.on('HISTORY_RESPONSE', (msg) => {
        if (msg.captures) setCaptures(msg.captures);
      }),
    ];

    setConnected(BridgeWS.connected);
    fetchHistory();

    return () => unsubs.forEach(u => u());
  }, [activeFilter, searchQuery]);

  const fetchHistory = () => {
    BridgeWS.send('HISTORY_REQUEST', {
      limit: 200,
      capture_type: activeFilter === 'all' ? undefined : activeFilter,
      search: searchQuery || undefined,
    });
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchHistory();
    setTimeout(() => setRefreshing(false), 1000);
  }, [activeFilter, searchQuery]);

  return (
    <View style={styles.container}>
      <VeritasHeader
        title="SOVEREIGN BRIDGE"
        subtitle="TIMELINE"
        connected={connected}
      />

      {/* Search bar */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search captures & OCR text..."
          placeholderTextColor={colors.textFaint}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={fetchHistory}
          returnKeyType="search"
        />
      </View>

      {/* Type filters */}
      <View style={styles.filterRow}>
        {FILTER_TYPES.map(type => (
          <TouchableOpacity
            key={type}
            style={[
              styles.filterChip,
              activeFilter === type && styles.filterChipActive,
            ]}
            onPress={() => setActiveFilter(type)}
          >
            <Text style={[
              styles.filterText,
              activeFilter === type && styles.filterTextActive,
            ]}>
              {type.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Timeline */}
      <FlatList
        data={captures}
        keyExtractor={(item) => item.id || `${item.timestamp}`}
        renderItem={({ item }) => (
          <CaptureCard capture={item} />
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
            <Text style={styles.emptyIcon}>🕰</Text>
            <Text style={styles.emptyText}>No history</Text>
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
  searchRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  searchInput: {
    backgroundColor: colors.obsidianLight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: 'System',
    fontSize: 14,
    color: colors.text,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    flexWrap: 'wrap',
  },
  filterChip: {
    backgroundColor: colors.obsidianMid,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
  },
  filterChipActive: {
    backgroundColor: colors.goldGlow,
    borderColor: colors.gold,
  },
  filterText: {
    fontFamily: fonts.mono,
    fontSize: 8,
    letterSpacing: 1,
    color: colors.textDim,
  },
  filterTextActive: {
    color: colors.gold,
  },
  list: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 80,
  },
  emptyIcon: { fontSize: 40, marginBottom: spacing.md },
  emptyText: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.goldDim,
    letterSpacing: 2,
  },
});

export default HistoryScreen;
