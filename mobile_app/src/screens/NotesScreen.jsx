/**
 * NotesScreen — Shared Notepad
 * ==============================
 * Real-time synced notes between PC and phone.
 * Multiple notes, version history, conflict awareness.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity,
  StyleSheet, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { colors, spacing, fonts, radius } from '../theme/veritas';
import VeritasHeader from '../components/VeritasHeader';
import BridgeWS from '../services/BridgeWebSocketService';

const NotesScreen = () => {
  const [notes, setNotes] = useState([]);
  const [activeNote, setActiveNote] = useState(null);
  const [noteContent, setNoteContent] = useState('');
  const [connected, setConnected] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    const unsubs = [
      BridgeWS.on('connected', () => setConnected(true)),
      BridgeWS.on('disconnected', () => setConnected(false)),
      BridgeWS.on('NOTES_RESPONSE', (msg) => {
        if (msg.notes) setNotes(msg.notes);
      }),
      BridgeWS.on('SYNC_RESPONSE', (msg) => {
        if (msg.notes) setNotes(msg.notes);
      }),
      BridgeWS.on('NOTE_UPDATED', (msg) => {
        setNotes(prev => {
          const idx = prev.findIndex(n => n.id === msg.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = msg;
            return updated;
          }
          return [msg, ...prev];
        });
        // If this is the active note and from PC, update content
        if (activeNote?.id === msg.id && msg.updated_by === 'pc') {
          setNoteContent(msg.content);
        }
      }),
    ];

    setConnected(BridgeWS.connected);
    BridgeWS.send('NOTES_REQUEST', {});

    return () => unsubs.forEach(u => u());
  }, [activeNote?.id]);

  const createNote = () => {
    BridgeWS.send('NOTE_UPDATE', {
      title: `Note ${notes.length + 1}`,
      content: '',
      source: 'phone',
    });
    BridgeWS.send('NOTES_REQUEST', {});
  };

  const selectNote = (note) => {
    setActiveNote(note);
    setNoteContent(note.content || '');
  };

  const onContentChange = (text) => {
    setNoteContent(text);

    // Debounced sync (500ms)
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (activeNote?.id) {
        BridgeWS.send('NOTE_UPDATE', {
          note_id: activeNote.id,
          content: text,
          source: 'phone',
        });
      }
    }, 500);
  };

  const deleteNote = (note) => {
    Alert.alert('Delete Note', `Delete "${note.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setNotes(prev => prev.filter(n => n.id !== note.id));
          if (activeNote?.id === note.id) {
            setActiveNote(null);
            setNoteContent('');
          }
        },
      },
    ]);
  };

  // Note list view
  if (!activeNote) {
    return (
      <View style={styles.container}>
        <VeritasHeader
          title="SOVEREIGN BRIDGE"
          subtitle="NOTES"
          connected={connected}
        />

        <TouchableOpacity style={styles.newNoteBtn} onPress={createNote}>
          <Text style={styles.newNoteBtnText}>+ NEW NOTE</Text>
        </TouchableOpacity>

        <FlatList
          data={notes}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.noteCard}
              onPress={() => selectNote(item)}
              onLongPress={() => deleteNote(item)}
            >
              <View style={styles.noteCardHeader}>
                <Text style={styles.noteTitle}>{item.title || 'Untitled'}</Text>
                <Text style={styles.noteVersion}>v{item.version}</Text>
              </View>
              <Text style={styles.notePreview} numberOfLines={2}>
                {item.content || '(empty)'}
              </Text>
              <View style={styles.noteFooter}>
                <Text style={styles.noteTimestamp}>
                  {new Date(item.updated_at).toLocaleString()}
                </Text>
                <Text style={styles.noteSource}>
                  {item.updated_by === 'pc' ? 'PC' : 'PHONE'}
                </Text>
              </View>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.notesList}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📝</Text>
              <Text style={styles.emptyText}>No notes yet</Text>
              <Text style={styles.emptySubtext}>Create one to start syncing</Text>
            </View>
          }
        />
      </View>
    );
  }

  // Editor view
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <VeritasHeader
        title="SOVEREIGN BRIDGE"
        subtitle={activeNote.title || 'NOTE'}
        connected={connected}
      />

      <View style={styles.editorBar}>
        <TouchableOpacity onPress={() => setActiveNote(null)}>
          <Text style={styles.backBtn}>{'< BACK'}</Text>
        </TouchableOpacity>
        <Text style={styles.syncLabel}>
          {activeNote.updated_by === 'pc' ? 'Last: PC' : 'Last: PHONE'}
          {' v'}{activeNote.version}
        </Text>
      </View>

      <TextInput
        style={styles.editor}
        value={noteContent}
        onChangeText={onContentChange}
        multiline
        placeholder="Start typing..."
        placeholderTextColor={colors.textFaint}
        textAlignVertical="top"
        autoCorrect={false}
      />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.obsidian,
  },
  newNoteBtn: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.goldGlow,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  newNoteBtnText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 3,
    color: colors.gold,
    fontWeight: 'bold',
  },
  notesList: {
    padding: spacing.lg,
  },
  noteCard: {
    backgroundColor: colors.obsidianLight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  noteCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  noteTitle: {
    fontFamily: fonts.mono,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.gold,
    fontWeight: 'bold',
  },
  noteVersion: {
    fontFamily: fonts.mono,
    fontSize: 9,
    color: colors.textDim,
  },
  notePreview: {
    fontFamily: 'System',
    fontSize: 13,
    color: colors.textDim,
    lineHeight: 18,
    marginBottom: 8,
  },
  noteFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  noteTimestamp: {
    fontFamily: fonts.mono,
    fontSize: 8,
    color: colors.textFaint,
  },
  noteSource: {
    fontFamily: fonts.mono,
    fontSize: 8,
    letterSpacing: 1,
    color: colors.goldDim,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyIcon: { fontSize: 40, marginBottom: spacing.md },
  emptyText: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.goldDim,
    letterSpacing: 2,
  },
  emptySubtext: {
    fontFamily: 'System',
    fontSize: 12,
    color: colors.textFaint,
    marginTop: 4,
  },
  editorBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.gold,
  },
  syncLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    color: colors.textDim,
  },
  editor: {
    flex: 1,
    padding: spacing.lg,
    fontFamily: 'System',
    fontSize: 15,
    color: colors.text,
    lineHeight: 24,
  },
});

export default NotesScreen;
