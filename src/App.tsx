import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "sonner";
import { Plus, Scissors, Clock, CalendarDays, Settings, Trash2 } from "lucide-react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ===== Supabase (env) =====
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase: SupabaseClient | null = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// Utilidades
const money = (v:number)=> v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pad = (n:number)=> String(n).padStart(2,"0");

// Tipos
type Service = { id:string; nome:string; duracaoMin:number; preco:number };
type Booking = { id:string; cliente:string; telefone:string; dataISO:string; inicioMin:number; fimMin:number; servicoId:string; observacoes?:string };
type Config = {
  nomeBarbearia: string;
  intervaloMin: number;
  diasAtivos: number[];
  horaAbertura: string;
  horaFechamento: string;
};

// Storage helpers (fallback local)
const LS_SERVICES = "barber.services.v1";
const LS_BOOKINGS = "barber.bookings.v1"; // apenas do DIA selecionado neste MVP com Supabase
const LS_CONFIG   = "barber.config.v1";

const defaultServices: Service[] = [
  { id: crypto.randomUUID(), nome: "Corte Masculino", duracaoMin: 45, preco: 55 },
  { id: crypto.randomUUID(), nome: "Barba",           duracaoMin: 30, preco: 40 },
  { id: crypto.randomUUID(), nome: "Corte + Barba",   duracaoMin: 75, preco: 85 },
  { id: crypto.randomUUID(), nome: "Sobrancelha",     duracaoMin: 15, preco: 20 },
];

const defaultConfig: Config = {
  nomeBarbearia: "Barbearia do Bairro",
  intervaloMin: 15,
  diasAtivos: [1,2,3,4,5,6],
  horaAbertura: "09:00",
  horaFechamento: "19:00",
};

function loadServicesLocal(): Service[] {
  const raw = localStorage.getItem(LS_SERVICES);
  if (!raw) return defaultServices;
  try { return JSON.parse(raw); } catch { return defaultServices; }
}
function saveServicesLocal(list: Service[]) { localStorage.setItem(LS_SERVICES, JSON.stringify(list)); }

function loadBookingsLocal(): Booking[] {
  const raw = localStorage.getItem(LS_BOOKINGS);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}
function saveBookingsLocal(list: Booking[]) { localStorage.setItem(LS_BOOKINGS, JSON.stringify(list)); }

function loadConfigLocal(): Config {
  const raw = localStorage.getItem(LS_CONFIG);
  if (!raw) return defaultConfig;
  try { return JSON.parse(raw); } catch { return defaultConfig; }
}
function saveConfigLocal(cfg: Config) { localStorage.setItem(LS_CONFIG, JSON.stringify(cfg)); }

// Helpers de tempo
function timeToMin(t:"HH:MM"|string){ const [h,m] = t.split(":").map(Number); return h*60+m; }
function minToTime(min:number){ const h = Math.floor(min/60), m = min%60; return `${pad(h)}:${pad(m)}`; }
function dateToISO(d:Date){ return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString(); }
function getDayBookings(bookings: Booking[], day: Date){
  const iso = dateToISO(day);
  return bookings.filter(b=> b.dataISO===iso).sort((x,y)=> x.inicioMin - y.inicioMin);
}

// ===== Supabase helpers =====
async function sbFetchServices(): Promise<Service[]|null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("services")
    .select("id,nome: name,duracaoMin: duration_min,preco: price")
    .order("name", { ascending: true });
  if (error) { console.error(error); return null; }
  return (data || []).map(r=> ({ id:r.id, nome:r.nome, duracaoMin:r.duracaoMin, preco:r.preco }));
}

async function sbInsertService(s: Omit<Service,'id'>){
  if (!supabase) return;
  const { error } = await supabase.from("services").insert({ name: s.nome, duration_min: s.duracaoMin, price: s.preco });
  if (error) throw error;
}
async function sbDeleteService(id:string){ if (supabase) { const { error } = await supabase.from("services").delete().eq("id", id); if (error) throw error; } }

async function sbFetchConfig(): Promise<Config|null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("config").select("nomeBarbearia: shop_name, intervaloMin: slot_min, diasAtivos: days_active, horaAbertura: open_time, horaFechamento: close_time").single();
  if (error) { console.error(error); return null; }
  const cfg = data as unknown as Config;
  return {
    nomeBarbearia: cfg.nomeBarbearia ?? defaultConfig.nomeBarbearia,
    intervaloMin: cfg.intervaloMin ?? defaultConfig.intervaloMin,
    diasAtivos: (cfg.diasAtivos ?? defaultConfig.diasAtivos) as number[],
    horaAbertura: cfg.horaAbertura ?? defaultConfig.horaAbertura,
    horaFechamento: cfg.horaFechamento ?? defaultConfig.horaFechamento,
  };
}
async function sbUpsertConfig(cfg: Config){
  if (!supabase) return;
  const payload = {
    shop_name: cfg.nomeBarbearia,
    slot_min: cfg.intervaloMin,
    days_active: cfg.diasAtivos,
    open_time: cfg.horaAbertura,
    close_time: cfg.horaFechamento,
    id: 1,
  };
  const { error } = await supabase.from("config").upsert(payload, { onConflict: "id" });
  if (error) throw error;
}

async function sbFetchBookingsByISO(iso: string): Promise<Booking[]|null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("bookings")
    .select("id,cliente: customer_name,telefone: phone,dataISO: date_iso,inicioMin: start_min,fimMin: end_min,servicoId: service_id,observacoes: notes, services(name,duration_min,price)")
    .eq("date_iso", iso)
    .order("start_min", { ascending: true });
  if (error) { console.error(error); return null; }
  return (data || []).map(r=> ({
    id: r.id,
    cliente: r.cliente,
    telefone: r.telefone,
    dataISO: r.dataISO,
    inicioMin: r.inicioMin,
    fimMin: r.fimMin,
    servicoId: r.servicoId,
    observacoes: r.observacoes ?? undefined,
  }));
}

async function sbInsertBooking(b: Omit<Booking,'id'>){
  if (!supabase) return;
  const { error } = await supabase.from("bookings").insert({
    customer_name: b.cliente,
    phone: b.telefone,
    date_iso: b.dataISO,
    start_min: b.inicioMin,
    end_min: b.fimMin,
    service_id: b.servicoId,
    notes: b.observacoes ?? null,
  });
  if (error) throw error;
}
async function sbDeleteBooking(id:string){ if (supabase){ const { error } = await supabase.from("bookings").delete().eq("id", id); if (error) throw error; } }

// Componentes auxiliares
function SectionTitle({icon:Icon, title}:{icon:any; title:string}){
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-5 h-5" />
      <h3 className="text-lg font-semibold">{title}</h3>
    </div>
  );
}

function ServiceBadge({s, selected, onClick}:{s:Service; selected:boolean; onClick:()=>void}){
  return (
    <button onClick={onClick}
      className={`rounded-2xl px-4 py-3 text-left shadow-sm border transition hover:shadow
      ${selected? "border-foreground bg-muted" : "border-border bg-card"}`}
    >
      <div className="flex items-center gap-2">
        <Scissors className="w-4 h-4" />
        <span className="font-medium">{s.nome}</span>
      </div>
      <div className="text-sm opacity-80 flex items-center gap-2 mt-1">
        <Clock className="w-3 h-3" /> {s.duracaoMin} min · {money(s.preco)}
      </div>
    </button>
  );
}

function TimeButton({min, selected, onClick}:{min:number; selected:boolean; onClick:()=>void}){
  return (
    <Button variant={selected?"default":"secondary"} onClick={onClick} className="rounded-xl">
      {minToTime(min)}
    </Button>
  );
}

// Painel administrativo
function AdminPanel({services, setServices, cfg, setCfg}:{
  services: Service[];
  setServices: (s:Service[])=>void;
  cfg: Config;
  setCfg: (c:Config)=>void;
}){
  const [novo, setNovo] = useState({nome:"", duracaoMin:30, preco:50});

  async function addService(){
    if(!novo.nome.trim()) return toast.error("Dê um nome ao serviço");
    if (supabase) {
      try { await sbInsertService(novo as Omit<Service,'id'>); toast.success("Serviço adicionado"); } catch(e:any){ toast.error("Erro ao salvar serviço online"); console.error(e); }
      const s = await sbFetchServices(); if (s) setServices(s);
    } else {
      const list = [...services, { id: crypto.randomUUID(), ...novo } as Service];
      setServices(list); saveServicesLocal(list);
    }
    setNovo({nome:"", duracaoMin:30, preco:50});
  }

  async function removeService(id:string){
    if (supabase) {
      try { await sbDeleteService(id); toast("Serviço removido"); } catch(e:any){ toast.error("Erro ao remover serviço"); console.error(e); }
      const s = await sbFetchServices(); if (s) setServices(s);
    } else {
      const list = services.filter(s=> s.id!==id);
      setServices(list); saveServicesLocal(list);
    }
  }

  async function updateCfg<K extends keyof Config>(k:K, v:Config[K]){
    const next = { ...cfg, [k]: v };
    setCfg(next);
    if (supabase) { try { await sbUpsertConfig(next); } catch(e:any){ console.error(e); toast.error("Erro ao salvar config"); } }
    else { saveConfigLocal(next); }
  }

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Serviços</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <Input placeholder="Nome" value={novo.nome} onChange={e=> setNovo(p=>({...p, nome:e.target.value}))} />
            <Input type="number" min={5} step={5} value={novo.duracaoMin}
              onChange={e=> setNovo(p=>({...p, duracaoMin: Number(e.target.value)}))} placeholder="Duração (min)" />
            <Input type="number" min={0} step={1} value={novo.preco}
              onChange={e=> setNovo(p=>({...p, preco: Number(e.target.value)}))} placeholder="Preço (R$)" />
            <Button onClick={addService} className="w-full"><Plus className="w-4 h-4 mr-2"/>Adicionar</Button>
          </div>
          <div className="space-y-2">
            {services.map(s=> (
              <div key={s.id} className="flex items-center justify-between border rounded-xl p-3">
                <div>
                  <div className="font-medium">{s.nome}</div>
                  <div className="text-sm opacity-75">{s.duracaoMin} min · {money(s.preco)}</div>
                </div>
                <Button variant="destructive" size="icon" onClick={()=> removeService(s.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuração de Agenda</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Nome da barbearia</Label>
              <Input value={cfg.nomeBarbearia} onChange={e=> updateCfg("nomeBarbearia", e.target.value)} />
            </div>
            <div>
              <Label>Tamanho do slot (min)</Label>
              <Input type="number" min={5} step={5} value={cfg.intervaloMin}
                onChange={e=> updateCfg("intervaloMin", Number(e.target.value))} />
            </div>
            <div>
              <Label>Abre às</Label>
              <Input type="time" value={cfg.horaAbertura} onChange={e=> updateCfg("horaAbertura", e.target.value)} />
            </div>
            <div>
              <Label>Fecha às</Label>
              <Input type="time" value={cfg.horaFechamento} onChange={e=> updateCfg("horaFechamento", e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Dias ativos</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {[
                {i:0, n:"Dom"},{i:1, n:"Seg"},{i:2, n:"Ter"},{i:3, n:"Qua"},{i:4, n:"Qui"},{i:5, n:"Sex"},{i:6, n:"Sáb"},
              ].map(d=> (
                <Button key={d.i} variant={cfg.diasAtivos.includes(d.i)?"default":"secondary"}
                  onClick={()=>{
                    const set = new Set(cfg.diasAtivos);
                    if(set.has(d.i)) set.delete(d.i); else set.add(d.i);
                    updateCfg("diasAtivos", Array.from(set).sort());
                  }}
                  className="rounded-xl"
                >{d.n}</Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function App(){
  const [services, setServices] = useState<Service[]>(loadServicesLocal());
  const [bookings, setBookings] = useState<Booking[]>(loadBookingsLocal()); // manteremos só os do dia atual
  const [cfg, setCfg] = useState<Config>(loadConfigLocal());

  const [servId, setServId] = useState<string>("");
  const [date, setDate] = useState<Date>(new Date());
  const [inicio, setInicio] = useState<number|undefined>(undefined);

  // dados do cliente
  const [cliente, setCliente] = useState("");
  const [telefone, setTelefone] = useState("");
  const [obs, setObs] = useState("");

  // modo barbeiro (PIN fixo 1801)
  const [barberMode, setBarberMode] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinTyped, setPinTyped] = useState("");

  // boot: carregar dados do Supabase (ou manter local)
  useEffect(()=>{
    (async()=>{
      if (!supabase){ toast.info("Modo offline (LocalStorage)"); return; }
      const [s, c] = await Promise.all([sbFetchServices(), sbFetchConfig()]);
      if (s && s.length){ setServices(s); } else { setServices(defaultServices); }
      if (c){ setCfg(c); }
    })();
  }, []);

  // quando data mudar, buscar agendamentos do dia no Supabase
  useEffect(()=>{
    (async()=>{
      const iso = dateToISO(date);
      if (supabase){
        const day = await sbFetchBookingsByISO(iso);
        if (day) { setBookings(day); saveBookingsLocal(day); }
      } else {
        // fallback: filtra os do dia no local
        const local = loadBookingsLocal();
        setBookings(getDayBookings(local, date));
      }
    })();
  }, [date]);

  // garantias
  useEffect(()=>{ if (!servId && services[0]) setServId(services[0].id); }, [services, servId]);

  const servico = useMemo(()=> services.find(s=> s.id===servId), [services, servId]);
  const diaAtivo = cfg.diasAtivos.includes(date.getDay());

  const disponiveis = useMemo(()=> {
    if (!servico) return [] as number[];
    return slotsDisponiveis(cfg, servico, date, bookings);
  }, [cfg, servico, date, bookings]);

  async function reservar(){
    if(!servico) return toast.error("Escolha um serviço");
    if(!diaAtivo) return toast.error("Este dia não está disponível");
    if(inicio===undefined) return toast.error("Selecione um horário");
    if(!cliente.trim()) return toast.error("Informe seu nome");

    const fim = inicio + servico.duracaoMin;
    const conflito = bookings.some(b => !(fim <= b.inicioMin || inicio >= b.fimMin));
    if(conflito) return toast.error("Este horário acabou de ser ocupado. Tente outro.");

    const novo: Omit<Booking,'id'> = {
      cliente, telefone, observacoes: obs || undefined,
      dataISO: dateToISO(date),
      inicioMin: inicio, fimMin: fim,
      servicoId: servico.id,
    };

    if (supabase){
      try { await sbInsertBooking(novo); toast.success("Agendamento confirmado!"); }
      catch(e:any){ console.error(e); toast.error("Erro ao salvar no servidor"); return; }
      // refetch dia
      const day = await sbFetchBookingsByISO(novo.dataISO);
      if (day) { setBookings(day); saveBookingsLocal(day); }
    } else {
      const withId: Booking = { id: crypto.randomUUID(), ...novo } as Booking;
      const list = [...bookings, withId];
      setBookings(list); saveBookingsLocal(list);
      toast.success("Agendamento confirmado (local)!");
    }

    // limpa form
    setInicio(undefined); setCliente(""); setTelefone(""); setObs("");
  }

  async function cancelar(id:string){
    if(!barberMode){ toast.error("Apenas o barbeiro pode cancelar. Ative o Modo Barbeiro."); return; }
    if (supabase){
      try { await sbDeleteBooking(id); toast("Agendamento cancelado."); } catch(e:any){ console.error(e); toast.error("Erro ao cancelar"); return; }
      const day = await sbFetchBookingsByISO(dateToISO(date));
      if (day) { setBookings(day); saveBookingsLocal(day); }
    } else {
      const list = bookings.filter(b=> b.id!==id);
      setBookings(list); saveBookingsLocal(list);
      toast("Agendamento cancelado (local).");
    }
  }

  const doDia = useMemo(()=> getDayBookings(bookings, date), [bookings, date]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl md:text-3xl font-bold">{cfg.nomeBarbearia} — Agendamentos</h1>
          <div className="flex items-center gap-2">
            {/* Modo Barbeiro (PIN 1801) */}
            <Dialog open={pinOpen} onOpenChange={setPinOpen}>
              <DialogTrigger asChild>
                {!barberMode ? (
                  <Button variant="default" className="rounded-xl">Modo Barbeiro</Button>
                ) : (
                  <Button variant="secondary" className="rounded-xl" onClick={()=> setBarberMode(false)}>Sair do Modo Barbeiro</Button>
                )}
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Entrar no Modo Barbeiro</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <Label>Digite o PIN (senha única)</Label>
                  <Input type="password" value={pinTyped} onChange={e=> setPinTyped(e.target.value)} placeholder="1801" />
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={()=> { setPinTyped(""); setPinOpen(false); }}>Cancelar</Button>
                    <Button onClick={()=> {
                      if(pinTyped === "1801"){
                        setBarberMode(true);
                        setPinOpen(false);
                        setPinTyped("");
                        toast.success("Modo Barbeiro ativado");
                      } else {
                        toast.error("PIN incorreto");
                      }
                    }}>Entrar</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Admin só no modo barbeiro */}
            {barberMode && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" className="rounded-xl"><Settings className="w-4 h-4 mr-2"/> Admin</Button>
                </DialogTrigger>
                <DialogContent className="max-w-4xl">
                  <DialogHeader>
                    <DialogTitle>Configurar</DialogTitle>
                  </DialogHeader>
                  <AdminPanel services={services} setServices={setServices} cfg={cfg} setCfg={setCfg} />
                </DialogContent>
              </Dialog>
            )}
          </div>
        </header>

        <Tabs defaultValue="agendar">
          <TabsList className="grid grid-cols-2 w-full md:w-auto rounded-2xl">
            <TabsTrigger value="agendar">Agendar</TabsTrigger>
            <TabsTrigger value="agenda">Agenda do dia</TabsTrigger>
          </TabsList>

          <TabsContent value="agendar" className="mt-6">
            <div className="grid lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><CalendarDays className="w-5 h-5"/>Escolha serviço, data e horário</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <SectionTitle icon={Scissors} title="Serviços" />
                      <div className="grid sm:grid-cols-2 gap-3">
                        {services.map(s=> (
                          <ServiceBadge key={s.id} s={s} selected={servId===s.id} onClick={()=> { setServId(s.id); setInicio(undefined); }} />
                        ))}
                      </div>
                    </div>

                    <div>
                      <SectionTitle icon={CalendarDays} title="Data" />
                      <Calendar mode="single" selected={date} onSelect={(d:any)=> d && setDate(d)}
                        disabled={(d:any)=> !cfg.diasAtivos.includes(d.getDay())}
                        className="rounded-2xl border" />
                    </div>
                  </div>

                  <div>
                    <SectionTitle icon={Clock} title="Horários disponíveis" />
                    {!diaAtivo && <p className="text-sm opacity-70">Este dia não está habilitado na agenda.</p>}
                    {diaAtivo && (
                      <div className="flex flex-wrap gap-2">
                        {disponiveis.length===0 && <div className="opacity-70">Sem horários livres nesta data.</div>}
                        {disponiveis.map(t=> (
                          <TimeButton key={t} min={t} selected={inicio===t} onClick={()=> setInicio(t)} />
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Seus dados</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label>Nome</Label>
                    <Input placeholder="Seu nome" value={cliente} onChange={e=> setCliente(e.target.value)} />
                  </div>
                  <div>
                    <Label>Telefone (WhatsApp)</Label>
                    <Input placeholder="(XX) 9XXXX-XXXX" value={telefone} onChange={e=> setTelefone(e.target.value)} />
                  </div>
                  <div>
                    <Label>Observações</Label>
                    <Textarea placeholder="Preferências, referências, etc." value={obs} onChange={e=> setObs(e.target.value)} />
                  </div>

                  <div className="rounded-2xl bg-muted p-4 space-y-1">
                    <div className="text-sm opacity-80">Resumo</div>
                    <div className="font-medium">{servico? servico.nome : "Escolha um serviço"}</div>
                    <div className="text-sm opacity-80">
                      {date.toLocaleDateString()} · {inicio!==undefined? `${minToTime(inicio)} — ${minToTime((inicio??0) + (servico?.duracaoMin||0))}` : "Escolha horário"}
                    </div>
                    <div className="font-semibold">Total: {servico? money(servico.preco) : "—"}</div>
                  </div>

                  <Button className="w-full rounded-xl" onClick={reservar}>Confirmar agendamento</Button>
                  <p className="text-xs opacity-70">Se configurado, os dados são salvos no Supabase. Caso contrário, ficam apenas neste dispositivo.</p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="agenda" className="mt-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Selecionar data</CardTitle>
                </CardHeader>
                <CardContent>
                  <Calendar mode="single" selected={date} onSelect={(d:any)=> d && setDate(d)} className="rounded-2xl border" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Agendamentos de {date.toLocaleDateString()}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {doDia.length===0 && <div className="opacity-70">Nenhum agendamento.</div>}
                  {doDia.map(b=> {
                    const s = services.find(x=> x.id===b.servicoId);
                    return (
                      <div key={b.id} className="border rounded-xl p-3 flex items-center justify-between">
                        <div>
                          <div className="font-medium">{minToTime(b.inicioMin)} — {minToTime(b.fimMin)} · {s?.nome}</div>
                          <div className="text-sm opacity-80">{b.cliente} · {s? money(s.preco):""}</div>
                          {b.observacoes && <div className="text-xs opacity-70 mt-1">Obs: {b.observacoes}</div>}
                        </div>
                        <Button variant="destructive" onClick={()=> cancelar(b.id)}>Cancelar</Button>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        <footer className="text-sm opacity-70 text-center pt-4">
          MVP com Supabase opcional • Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para salvar online.
        </footer>
      </div>
    </div>
  );
}
