import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "sonner";
import { Plus, Scissors, Clock, CalendarDays, Settings, Trash2 } from "lucide-react";

// Utilidades
const money = (v:number)=> v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pad = (n:number)=> String(n).padStart(2,"0");

// Tipos
type Service = { id:string; nome:string; duracaoMin:number; preco:number };
type Booking = { id:string; cliente:string; telefone:string; dataISO:string; inicioMin:number; fimMin:number; servicoId:string; observacoes?:string };
type Config = {
  nomeBarbearia: string;
  intervaloMin: number; // tamanho do slot em minutos
  diasAtivos: number[]; // 0=Dom ... 6=Sáb
  horaAbertura: string; // "09:00"
  horaFechamento: string; // "18:00"
  barberPin?: string; // PIN simples para modo barbeiro
};

// Storage helpers
const LS_SERVICES = "barber.services.v1";
const LS_BOOKINGS = "barber.bookings.v1";
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
  diasAtivos: [1,2,3,4,5,6], // seg-sáb
  horaAbertura: "09:00",
  horaFechamento: "19:00",
  barberPin: "1234",
};

function loadServices(): Service[] {
  const raw = localStorage.getItem(LS_SERVICES);
  if (!raw) return defaultServices;
  try { return JSON.parse(raw); } catch { return defaultServices; }
}
function saveServices(list: Service[]) { localStorage.setItem(LS_SERVICES, JSON.stringify(list)); }

function loadBookings(): Booking[] {
  const raw = localStorage.getItem(LS_BOOKINGS);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}
function saveBookings(list: Booking[]) { localStorage.setItem(LS_BOOKINGS, JSON.stringify(list)); }

function loadConfig(): Config {
  const raw = localStorage.getItem(LS_CONFIG);
  if (!raw) return defaultConfig;
  try { return JSON.parse(raw); } catch { return defaultConfig; }
}
function saveConfig(cfg: Config) { localStorage.setItem(LS_CONFIG, JSON.stringify(cfg)); }

// Helpers de tempo
function timeToMin(t:"HH:MM"|string){ const [h,m] = t.split(":").map(Number); return h*60+m; }
function minToTime(min:number){ const h = Math.floor(min/60), m = min%60; return `${pad(h)}:${pad(m)}`; }

function sameDay(a:Date,b:Date){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }

function dateToISO(d:Date){ return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString(); }

function getDayBookings(bookings: Booking[], day: Date){
  const iso = dateToISO(day);
  return bookings.filter(b=> b.dataISO===iso).sort((x,y)=> x.inicioMin - y.inicioMin);
}

function slotsDisponiveis(cfg:Config, serv:Service, dia:Date, bookings: Booking[]){
  const abertura = timeToMin(cfg.horaAbertura);
  const fechamento = timeToMin(cfg.horaFechamento);
  const step = cfg.intervaloMin;
  const ocupados = getDayBookings(bookings, dia);

  const possiveis:number[] = [];
  for (let t = abertura; t + serv.duracaoMin <= fechamento; t += step){
    const fim = t + serv.duracaoMin;
    // checa conflito com reservas existentes
    const conflito = ocupados.some(b => !(fim <= b.inicioMin || t >= b.fimMin));
    if (!conflito) possiveis.push(t);
  }
  return possiveis;
}

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

// Painel administrativo simples
function AdminPanel({services, setServices, cfg, setCfg}:{
  services: Service[];
  setServices: (s:Service[])=>void;
  cfg: Config;
  setCfg: (c:Config)=>void;
}){
  const [novo, setNovo] = useState({nome:"", duracaoMin:30, preco:50});

  function addService(){
    if(!novo.nome.trim()) return toast.error("Dê um nome ao serviço");
    const list = [...services, { id: crypto.randomUUID(), ...novo } as Service];
    setServices(list); saveServices(list);
    setNovo({nome:"", duracaoMin:30, preco:50});
  }

  function removeService(id:string){
    const list = services.filter(s=> s.id!==id);
    setServices(list); saveServices(list);
  }

  function updateCfg<K extends keyof Config>(k:K, v:Config[K]){
    const next = { ...cfg, [k]: v };
    setCfg(next); saveConfig(next);
  }

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Serviços</CardTitle>
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
            <div className="sm:col-span-2">
              <Label>PIN do barbeiro (somente números)</Label>
              <Input type="password" value={cfg.barberPin || ""} onChange={e=> updateCfg("barberPin", e.target.value)} placeholder="ex.: 1234" />
              <p className="text-xs opacity-70 mt-1">O PIN habilita o <strong>Modo Barbeiro</strong> para cancelar agendamentos. Não compartilhe.</p>
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
  const [services, setServices] = useState<Service[]>(loadServices());
  const [bookings, setBookings] = useState<Booking[]>(loadBookings());
  const [cfg, setCfg] = useState<Config>(loadConfig());

  const [servId, setServId] = useState<string>(services[0]?.id ?? "");
  const [date, setDate] = useState<Date>(new Date());
  const [inicio, setInicio] = useState<number|undefined>(undefined);

  // dados do cliente
  const [cliente, setCliente] = useState("");
  const [telefone, setTelefone] = useState("");
  const [obs, setObs] = useState("");

  // modo barbeiro (sem login, via PIN)
  const [barberMode, setBarberMode] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinTyped, setPinTyped] = useState("");

  useEffect(()=> saveServices(services), [services]);
  useEffect(()=> saveBookings(bookings), [bookings]);

  // Normaliza seleção de serviço quando lista muda
  useEffect(()=>{
    if (!services.find(s=> s.id===servId)) setServId(services[0]?.id ?? "");
  }, [services]);

  const servico = useMemo(()=> services.find(s=> s.id===servId), [services, servId]);
  const diaAtivo = cfg.diasAtivos.includes(date.getDay());

  const disponiveis = useMemo(()=> {
    if (!servico) return [] as number[];
    return slotsDisponiveis(cfg, servico, date, bookings);
  }, [cfg, servico, date, bookings]);

  function reservar(){
    if(!servico) return toast.error("Escolha um serviço");
    if(!diaAtivo) return toast.error("Este dia não está disponível");
    if(inicio===undefined) return toast.error("Selecione um horário");
    if(!cliente.trim()) return toast.error("Informe seu nome");

    const fim = inicio + servico.duracaoMin;
    // segurança: revalidar conflitos
    const conflito = getDayBookings(bookings, date).some(b => !(fim <= b.inicioMin || inicio >= b.fimMin));
    if(conflito) return toast.error("Este horário acabou de ser ocupado. Tente outro.");

    const novo: Booking = {
      id: crypto.randomUUID(),
      cliente, telefone, observacoes: obs,
      dataISO: dateToISO(date),
      inicioMin: inicio, fimMin: fim,
      servicoId: servico.id,
    };
    const list = [...bookings, novo];
    setBookings(list);
    toast.success("Agendamento confirmado!");
    // limpa form
    setInicio(undefined); setCliente(""); setTelefone(""); setObs("");
  }

  function cancelar(id:string){
    if(!barberMode){ toast.error("Apenas o barbeiro pode cancelar. Ative o Modo Barbeiro."); return; }
    const list = bookings.filter(b=> b.id!==id);
    setBookings(list);
    toast("Agendamento cancelado.");
  }

  const doDia = useMemo(()=> getDayBookings(bookings, date), [bookings, date]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl md:text-3xl font-bold">{cfg.nomeBarbearia} — Agendamentos</h1>
          <div className="flex items-center gap-2">
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
                  <Label>Digite o PIN configurado</Label>
                  <Input type="password" value={pinTyped} onChange={e=> setPinTyped(e.target.value)} placeholder="ex.: 1234" />
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={()=> { setPinTyped(""); setPinOpen(false); }}>Cancelar</Button>
                    <Button onClick={()=> {
                      if((cfg.barberPin||"").trim().length===0){ toast.error("Defina um PIN em Configurar > Agenda"); return; }
                      if(pinTyped===cfg.barberPin){ setBarberMode(true); setPinOpen(false); setPinTyped(""); toast.success("Modo Barbeiro ativado"); }
                      else { toast.error("PIN incorreto"); }
                    }}>Entrar</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

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
                  <p className="text-xs opacity-70">*Armazenado localmente neste dispositivo (MVP). Integração com backend/WhatsApp pode ser adicionada.</p>
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
          MVP local • Para publicar: exporte para Next.js ou Vite e conecte a um backend (Supabase/Firebase) e envio WhatsApp.
        </footer>
      </div>
    </div>
  );
}
