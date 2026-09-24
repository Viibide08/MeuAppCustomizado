import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  Switch,
  ActivityIndicator,
  ScrollView,
  Platform,
  LogBox
} from 'react-native';
import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import * as ImagePicker from 'expo-image-picker';

// 1. Silenciar aviso de Push Remoto do Expo Go no Android
LogBox.ignoreLogs([
  'expo-notifications: Android Push notifications',
  'Android Push notifications (remote notifications)',
]);

const Notifications = require('expo-notifications');

// 2. Configuração Global de Notificação em Primeiro Plano
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

interface Estudo {
  id: number;
  materia: string;
  duracao_minutos: number;
  anotacao: string;
  latitude: number;
  longitude: number;
  status_foco: string;
  imagem_uri: string | null;
  data_hora: string;
  status: string;
}

const STORAGE_THEME_KEY = '@appedu:theme_preference';
const STORAGE_USER_KEY = '@appedu:student_name';

export default function App() {
  const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);
  const [estudos, setEstudos] = useState<Estudo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Form e Preferências
  const [nomeAluno, setNomeAluno] = useState<string>('Estudante');
  const [materia, setMateria] = useState('');
  const [duracao, setDuracao] = useState('');
  const [anotacao, setAnotacao] = useState('');
  const [imagemUri, setImagemUri] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Sensores
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [focoStatus, setFocoStatus] = useState<string>('Monitorando foco...');

  useEffect(() => {
    async function initApp() {
      try {
        // A. Carregar Preferências (AsyncStorage)
        const savedTheme = await AsyncStorage.getItem(STORAGE_THEME_KEY);
        if (savedTheme !== null) setIsDarkMode(savedTheme === 'dark');

        const savedUser = await AsyncStorage.getItem(STORAGE_USER_KEY);
        if (savedUser !== null) setNomeAluno(savedUser);

        // B. Configurar Notificações Locais
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Lembretes de Estudos',
            importance: Notifications.AndroidImportance.MAX,
          });
        }
        await Notifications.requestPermissionsAsync();

        // C. Inicializar SQLite (API Moderna)
        const database = await SQLite.openDatabaseAsync('appedu_db.db');
        setDb(database);
        await database.execAsync(`
          CREATE TABLE IF NOT EXISTS estudos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            materia TEXT NOT NULL,
            duracao_minutos INTEGER NOT NULL,
            anotacao TEXT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            status_foco TEXT NOT NULL,
            imagem_uri TEXT,
            data_hora TEXT NOT NULL,
            status TEXT NOT NULL
          );
        `);

        // D. Sensores (GPS + Acelerômetro)
        await obterGeolocalizacao();
        iniciarMonitorFoco();

        // E. Carregar Histórico
        await carregarEstudos(database);
      } catch (error) {
        console.error("Erro na inicialização:", error);
        Alert.alert("Erro", "Falha ao carregar banco SQLite ou sensores.");
      } finally {
        setLoading(false);
      }
    }

    initApp();
  }, []);

  // GPS (Location)
  async function obterGeolocalizacao() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Aviso', 'Permissão de GPS negada.');
      return;
    }
    const loc = await Location.getCurrentPositionAsync({});
    setLocation(loc);
  }

  // Acelerômetro (Monitor de Foco / Distração)
  function iniciarMonitorFoco() {
    Accelerometer.setUpdateInterval(500);
    Accelerometer.addListener((data) => {
      const mag = Math.sqrt(data.x * data.x + data.y * data.y + data.z * data.z);
      if (mag > 1.6) {
        setFocoStatus('⚠️ Distração (Celular em Movimento)');
      } else {
        setFocoStatus('🎯 Foco Ativo (Celular na Mesa)');
      }
    });
  }

  // Câmera / ImagePicker (Foto da Lousa ou Resumo)
  async function tirarFotoResumo() {
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.5,
    });
    if (!result.canceled) {
      setImagemUri(result.assets[0].uri);
    }
  }

  // AsyncStorage: Salvar Tema
  async function toggleTheme(val: boolean) {
    setIsDarkMode(val);
    try {
      await AsyncStorage.setItem(STORAGE_THEME_KEY, val ? 'dark' : 'light');
    } catch (e) {
      console.error(e);
    }
  }

  // SQLite CRUD
  async function carregarEstudos(databaseInstance?: SQLite.SQLiteDatabase) {
    const activeDb = databaseInstance || db;
    if (!activeDb) return;
    try {
      const rows = await activeDb.getAllAsync<Estudo>('SELECT * FROM estudos ORDER BY id DESC;');
      setEstudos(rows);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleSalvarEstudo() {
    if (!materia.trim() || !duracao.trim()) {
      Alert.alert('Aviso', 'Preencha a matéria e o tempo em minutos.');
      return;
    }
    if (!location) {
      Alert.alert('Aviso', 'Obtendo localização do estudo...');
      await obterGeolocalizacao();
      return;
    }
    if (!db) return;

    try {
      const dataHora = new Date().toLocaleString('pt-BR');
      const min = parseInt(duracao, 10) || 30;

      // INSERT SQLite
      await db.runAsync(
        `INSERT INTO estudos 
        (materia, duracao_minutos, anotacao, latitude, longitude, status_foco, imagem_uri, data_hora, status) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          materia.trim(),
          min,
          anotacao.trim() || 'Sem anotações',
          location.coords.latitude,
          location.coords.longitude,
          focoStatus,
          imagemUri,
          dataHora,
          'Pendente',
        ]
      );

      // NOTIFICAÇÃO LOCAL (Lembrete de Revisão em 5 segundos)
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "📚 Sessão de Estudo Registrada!",
          body: `Revisão de ${materia.trim()} cadastrada com sucesso no AppEdu.`,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 5,
          channelId: 'default',
        },
      });

      Alert.alert('Sucesso', 'Sessão de estudo salva no banco SQLite!');
      setMateria('');
      setDuracao('');
      setAnotacao('');
      setImagemUri(null);
      await carregarEstudos();
    } catch (e) {
      console.error("Erro ao salvar:", e);
      Alert.alert('Erro', 'Falha ao gravar estudo.');
    }
  }

  async function handleToggleStatus(item: Estudo) {
    if (!db) return;
    const novoStatus = item.status === 'Pendente' ? 'Concluída' : 'Pendente';
    try {
      await db.runAsync('UPDATE estudos SET status = ? WHERE id = ?;', [novoStatus, item.id]);
      await carregarEstudos();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDeletar(id: number) {
    if (!db) return;
    try {
      await db.runAsync('DELETE FROM estudos WHERE id = ?;', [id]);
      await carregarEstudos();
    } catch (e) {
      console.error(e);
    }
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={{ marginTop: 10 }}>Carregando AppEdu (SQLite + Sensores)...</Text>
      </View>
    );
  }

  const activeTheme = isDarkMode ? darkTheme : lightTheme;

  return (
    <ScrollView contentContainerStyle={[styles.container, activeTheme.container]}>
      {/* Header com Nome e Switch de Tema */}
      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.title, activeTheme.text]}>AppEdu 🎓</Text>
          <Text style={activeTheme.subText}>Bons estudos, {nomeAluno}!</Text>
        </View>
        <View style={styles.themeToggle}>
          <Text style={activeTheme.subText}>{isDarkMode ? 'Dark' : 'Light'}</Text>
          <Switch value={isDarkMode} onValueChange={toggleTheme} />
        </View>
      </View>

      {/* Card de Sensores em Tempo Real (GPS + Acelerômetro Foco) */}
      <View style={[styles.card, activeTheme.card]}>
        <Text style={[styles.cardTitle, activeTheme.text]}>📡 Monitor de Foco & Localização</Text>
        <Text style={activeTheme.subText}>
          📍 Local de Estudo: {location ? `${location.coords.latitude.toFixed(4)}, ${location.coords.longitude.toFixed(4)}` : 'Buscando GPS...'}
        </Text>
        <Text style={activeTheme.subText}>{focoStatus}</Text>
      </View>

      {/* Formulário de Novo Registro de Estudo */}
      <View style={[styles.card, activeTheme.card]}>
        <Text style={[styles.cardTitle, activeTheme.text]}>📝 Nova Sessão / Tarefa de Estudo</Text>
        <TextInput
          style={[styles.input, activeTheme.input]}
          placeholder="Matéria (ex: Programação Mobile, Banco de Dados)"
          placeholderTextColor="#94A3B8"
          value={materia}
          onChangeText={setMateria}
        />
        <TextInput
          style={[styles.input, activeTheme.input]}
          placeholder="Duração em minutos (ex: 45)"
          keyboardType="numeric"
          placeholderTextColor="#94A3B8"
          value={duracao}
          onChangeText={setDuracao}
        />
        <TextInput
          style={[styles.input, activeTheme.input]}
          placeholder="Anotações / Resumo rápido"
          placeholderTextColor="#94A3B8"
          value={anotacao}
          onChangeText={setAnotacao}
        />

        <TouchableOpacity style={styles.btnCamera} onPress={tirarFotoResumo}>
          <Text style={styles.btnText}>📷 {imagemUri ? 'Foto Anexada (Alterar)' : 'Fotografar Lousa / Resumo'}</Text>
        </TouchableOpacity>

        {imagemUri && <Image source={{ uri: imagemUri }} style={styles.preview} />}

        <TouchableOpacity style={styles.btnSave} onPress={handleSalvarEstudo}>
          <Text style={styles.btnText}>💾 Salvar no SQLite + Lembrete (5s)</Text>
        </TouchableOpacity>
      </View>

      {/* Lista de Registros SQLite */}
      <Text style={[styles.sectionTitle, activeTheme.text]}>Sessões Salvas no SQLite ({estudos.length})</Text>

      {estudos.map((item) => (
        <View key={item.id} style={[styles.itemRow, activeTheme.card]}>
          {item.imagem_uri && <Image source={{ uri: item.imagem_uri }} style={styles.thumb} />}
          <View style={{ flex: 1, marginLeft: item.imagem_uri ? 10 : 0 }}>
            <Text style={[styles.itemTitle, activeTheme.text]}>{item.materia} ({item.duracao_minutos} min)</Text>
            <Text style={activeTheme.subText}>📝 {item.anotacao}</Text>
            <Text style={activeTheme.subText}>📍 {item.latitude.toFixed(3)}, {item.longitude.toFixed(3)}</Text>
            <Text style={activeTheme.subText}>{item.status_foco}</Text>
            <Text style={activeTheme.subText}>📅 {item.data_hora} | {item.status}</Text>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btnAction, item.status === 'Pendente' ? styles.btnDone : styles.btnActive]}
              onPress={() => handleToggleStatus(item)}
            >
              <Text style={styles.btnActionText}>{item.status === 'Pendente' ? 'Concluir' : 'Reabrir'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnDelete} onPress={() => handleDeletar(item.id)}>
              <Text style={styles.btnActionText}>Excluir</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { padding: 20, paddingTop: 50 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  title: { fontSize: 24, fontWeight: 'bold' },
  themeToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { padding: 14, borderRadius: 10, marginBottom: 15 },
  cardTitle: { fontWeight: 'bold', marginBottom: 10, fontSize: 16 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 10 },
  btnCamera: { backgroundColor: '#475569', padding: 12, borderRadius: 8, alignItems: 'center', marginBottom: 10 },
  btnSave: { backgroundColor: '#16A34A', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 5 },
  btnText: { color: '#FFFFFF', fontWeight: 'bold' },
  preview: { width: '100%', height: 140, borderRadius: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 10 },
  itemRow: { flexDirection: 'row', padding: 10, borderRadius: 8, marginBottom: 10, alignItems: 'center' },
  thumb: { width: 50, height: 50, borderRadius: 6 },
  itemTitle: { fontWeight: 'bold', fontSize: 15 },
  actions: { gap: 4 },
  btnAction: { paddingVertical: 5, paddingHorizontal: 8, borderRadius: 4 },
  btnDone: { backgroundColor: '#2563EB' },
  btnActive: { backgroundColor: '#D97706' },
  btnDelete: { backgroundColor: '#DC2626', paddingVertical: 5, paddingHorizontal: 8, borderRadius: 4 },
  btnActionText: { color: '#FFFFFF', fontSize: 11, fontWeight: 'bold' },
});

const lightTheme = StyleSheet.create({
  container: { backgroundColor: '#F8FAFC' },
  text: { color: '#0F172A' },
  subText: { color: '#64748B', fontSize: 12 },
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0' },
  input: { borderColor: '#CBD5E1', color: '#0F172A', backgroundColor: '#F8FAFC' },
});

const darkTheme = StyleSheet.create({
  container: { backgroundColor: '#0F172A' },
  text: { color: '#F8FAFC' },
  subText: { color: '#94A3B8', fontSize: 12 },
  card: { backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#334155' },
  input: { borderColor: '#475569', color: '#F8FAFC', backgroundColor: '#0F172A' },
});
