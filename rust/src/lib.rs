use std::slice;

const NONE: u32 = 0;
const LAP_COMPLETE: u32 = 1;
const TOO_FAST: u32 = 2;
const OFF_TRACK: u32 = 3;
const RIDER_CONTACT: u32 = 4;
const ROCK_STRIKE: u32 = 5;
const FINISH: u32 = 6;
const TRACK_WIDTH: f32 = 10.5;

#[derive(Clone, Copy)]
struct Hazard {
    distance: f32,
    offset: f32,
    radius: f32,
}

#[derive(Clone, Copy)]
struct Racer {
    distance: f32,
    base_speed: f32,
    lane: f32,
    phase: f32,
}

impl Racer {
    fn lane_at(self, time: f32) -> f32 {
        self.lane + (time * 0.32 + self.phase).sin() * 0.35
    }
}

struct Engine {
    track_length: f32,
    curvature: Vec<f32>,
    hazards: Vec<Hazard>,
    racers: [Racer; 2],
    freedom: bool,
    running: bool,
    speed: f32,
    distance: f32,
    lane_offset: f32,
    lateral_velocity: f32,
    steer: f32,
    throttle: bool,
    brake: bool,
    session_time: f32,
    lap_started_at: f32,
    last_lap: f32,
    best_lap: f32,
    checkpoint: f32,
    crash_timer: f32,
    crash_speed: f32,
    event: u32,
    corner_distance: f32,
    corner_curvature: f32,
}

impl Engine {
    fn new(track_length: f32, freedom: bool) -> Self {
        Self {
            track_length,
            curvature: Vec::new(),
            hazards: Vec::new(),
            racers: [
                Racer { distance: 18.0, base_speed: 24.0, lane: -2.7, phase: 1.4 },
                Racer { distance: 38.0, base_speed: 29.0, lane: 2.8, phase: 4.2 },
            ],
            freedom,
            running: false,
            speed: 0.0,
            distance: 0.0,
            lane_offset: 0.0,
            lateral_velocity: 0.0,
            steer: 0.0,
            throttle: false,
            brake: false,
            session_time: 0.0,
            lap_started_at: 0.0,
            last_lap: 0.0,
            best_lap: 0.0,
            checkpoint: 0.0,
            crash_timer: 0.0,
            crash_speed: 0.0,
            event: NONE,
            corner_distance: -1.0,
            corner_curvature: 0.0,
        }
    }

    fn curvature_at(&self, distance: f32) -> f32 {
        if self.curvature.is_empty() || self.track_length <= 0.0 {
            return 0.0;
        }
        let sample = distance.rem_euclid(self.track_length) / 5.0;
        let i = sample.floor() as usize;
        let fraction = sample - i as f32;
        let a = self.curvature[i % self.curvature.len()];
        let b = self.curvature[(i + 1) % self.curvature.len()];
        a + (b - a) * fraction
    }

    fn next_corner(&self) -> (f32, f32) {
        let mut distance = 10.0;
        while distance <= 170.0 {
            let curve = self.curvature_at(self.distance + distance);
            if curve.abs() > 0.0058 {
                return (distance, curve);
            }
            distance += 5.0;
        }
        (-1.0, 0.0)
    }

    fn wrap_gap(&self, target: f32, current: f32) -> f32 {
        (target - current + self.track_length * 0.5).rem_euclid(self.track_length) - self.track_length * 0.5
    }

    fn crash(&mut self, event: u32) {
        if !self.running {
            return;
        }
        self.event = event;
        self.crash_speed = self.speed * 3.6;
        self.speed = 0.0;
        self.lateral_velocity = 0.0;
        self.running = false;
        self.steer = 0.0;
        self.throttle = false;
        self.brake = false;
    }

    fn start(&mut self) {
        self.running = true;
        self.distance = 0.0;
        self.lane_offset = 0.0;
        self.lateral_velocity = 0.0;
        self.speed = 0.0;
        self.session_time = 0.0;
        self.lap_started_at = 0.0;
        self.last_lap = 0.0;
        self.checkpoint = 0.0;
        self.crash_timer = 0.0;
        self.event = NONE;
        self.racers[0].distance = 18.0;
        self.racers[1].distance = 38.0;
        self.clear_input();
    }

    fn clear_input(&mut self) {
        self.steer = 0.0;
        self.throttle = false;
        self.brake = false;
    }

    fn step(&mut self, dt: f32) {
        if !self.running || dt <= 0.0 {
            return;
        }
        let dt = dt.min(0.05);
        self.event = NONE;

        let acceleration = if self.throttle { 7.4 } else { 0.0 };
        let braking = if self.brake { 12.0 } else { 0.0 };
        let drag = 0.1 + self.speed * 0.07 + self.speed * self.speed * 0.0018;
        self.speed = (self.speed + (acceleration - braking - drag) * dt).max(0.0);
        if !self.freedom {
            self.speed = self.speed.min(78.5);
        }

        let curve = self.curvature_at(self.distance);
        let steering_accel = 2.4 + self.speed.min(38.0) * 0.36;
        let cornering_demand = self.speed * self.speed * curve.abs();
        let outward_accel = curve.signum() * ((cornering_demand - 7.5) * 0.24).clamp(0.0, 7.5);
        self.lateral_velocity += (self.steer * steering_accel - outward_accel) * dt;
        self.lateral_velocity = self.lateral_velocity.clamp(-4.8, 4.8);
        if self.steer == 0.0 {
            self.lateral_velocity *= (-3.2 * dt).exp();
        }
        self.lane_offset += self.lateral_velocity * dt;
        self.distance += self.speed * dt;
        self.session_time += dt;

        let lap = (self.distance / self.track_length).floor() as u32 + 1;
        let prior_lap = ((self.distance - self.speed * dt) / self.track_length).floor() as u32 + 1;
        if lap > prior_lap {
            self.last_lap = self.session_time - self.lap_started_at;
            self.lap_started_at = self.session_time;
            if self.best_lap <= 0.0 || self.last_lap < self.best_lap {
                self.best_lap = self.last_lap;
            }
            self.event = LAP_COMPLETE;
            if lap > 3 {
                self.event = FINISH;
                self.running = false;
                self.clear_input();
                return;
            }
        }

        let (corner_distance, corner_curve) = self.next_corner();
        self.corner_distance = corner_distance;
        self.corner_curvature = corner_curve;
        if corner_distance >= 0.0 {
            if corner_distance < 110.0 && corner_distance > 70.0 {
                let candidate = self.distance + (corner_distance - 48.0).max(0.0);
                if (candidate - self.checkpoint).abs() > 20.0 {
                    self.checkpoint = candidate;
                }
            }
            let current_demand = self.speed * self.speed * self.curvature_at(self.distance).abs();
            if !self.freedom && current_demand > 27.5 {
                self.crash_timer += dt;
            } else {
                self.crash_timer = (self.crash_timer - dt * 1.5).max(0.0);
            }
            if !self.freedom && self.crash_timer > 0.3 {
                self.crash(TOO_FAST);
                return;
            }
        } else {
            self.crash_timer = 0.0;
        }

        let rock_collision = self.hazards.iter().any(|hazard| {
            let longitudinal = self.wrap_gap(hazard.distance, self.distance);
            longitudinal.hypot(self.lane_offset - hazard.offset) < hazard.radius
        });
        if rock_collision {
            self.crash(ROCK_STRIKE);
            return;
        }

        if self.lane_offset.abs() > TRACK_WIDTH * 0.5 - 0.2 {
            self.crash(OFF_TRACK);
            return;
        }

        let rider_collision = self.racers.iter().any(|racer| {
            let gap = self.wrap_gap(racer.distance, self.distance);
            let lane = racer.lane_at(self.session_time);
            gap.abs() < 2.8 && (self.lane_offset - lane).abs() < 1.45 && self.speed > 14.0
        });
        if rider_collision {
            self.crash(RIDER_CONTACT);
            return;
        }

        for racer in &mut self.racers {
            let pace = if self.freedom {
                racer.base_speed.max((self.speed * 0.94).min(racer.base_speed + 18.0))
            } else {
                racer.base_speed
            };
            racer.distance += pace * dt;
        }
    }

    fn safe_speed_kmh(&self) -> f32 {
        if self.corner_curvature.abs() <= 0.0 {
            return 0.0;
        }
        (20.0 / self.corner_curvature.abs()).sqrt() * 3.6
    }
}

static mut ENGINE: *mut Engine = std::ptr::null_mut();

unsafe fn engine_mut() -> &'static mut Engine {
    if ENGINE.is_null() {
        ENGINE = Box::into_raw(Box::new(Engine::new(1.0, true)));
    }
    &mut *ENGINE
}

#[no_mangle]
pub extern "C" fn engine_alloc_f32(length: u32) -> u32 {
    let mut values = Vec::<f32>::with_capacity(length as usize);
    let pointer = values.as_mut_ptr() as u32;
    std::mem::forget(values);
    pointer
}

#[no_mangle]
pub unsafe extern "C" fn engine_free_f32(pointer: u32, length: u32) {
    if pointer != 0 && length != 0 {
        drop(Vec::from_raw_parts(pointer as *mut f32, 0, length as usize));
    }
}

#[no_mangle]
pub extern "C" fn engine_init(track_length: f32, freedom: u32) {
    unsafe {
        if !ENGINE.is_null() { drop(Box::from_raw(ENGINE)); }
        ENGINE = Box::into_raw(Box::new(Engine::new(track_length, freedom != 0)));
    }
}

#[no_mangle]
pub unsafe extern "C" fn engine_set_curvature(pointer: u32, length: u32) {
    if length == 0 { engine_mut().curvature.clear(); return; }
    let samples = slice::from_raw_parts(pointer as *const f32, length as usize);
    engine_mut().curvature = samples.to_vec();
}

#[no_mangle]
pub unsafe extern "C" fn engine_set_hazards(pointer: u32, length: u32) {
    if length == 0 { engine_mut().hazards.clear(); return; }
    let values = slice::from_raw_parts(pointer as *const f32, length as usize);
    engine_mut().hazards = values.chunks_exact(3).map(|chunk| Hazard {
        distance: chunk[0], offset: chunk[1], radius: chunk[2],
    }).collect();
}

#[no_mangle]
pub unsafe extern "C" fn engine_set_mode(freedom: u32) {
    engine_mut().freedom = freedom != 0;
}

#[no_mangle]
pub unsafe extern "C" fn engine_set_best_lap(seconds: f32) {
    engine_mut().best_lap = seconds.max(0.0);
}

#[no_mangle]
pub unsafe extern "C" fn engine_set_input(steer: f32, throttle: u32, brake: u32) {
    let engine = engine_mut();
    engine.steer = steer.clamp(-1.0, 1.0);
    engine.throttle = throttle != 0;
    engine.brake = brake != 0;
}

#[no_mangle]
pub unsafe extern "C" fn engine_start() { engine_mut().start(); }

#[no_mangle]
pub unsafe extern "C" fn engine_reset() {
    let engine = engine_mut();
    engine.distance = engine.checkpoint;
    engine.lane_offset = 0.0;
    engine.lateral_velocity = 0.0;
    engine.speed = 0.0;
    engine.crash_timer = 0.0;
    engine.last_lap = 0.0;
    engine.lap_started_at = engine.session_time;
    engine.event = NONE;
    engine.running = true;
    engine.clear_input();
}

#[no_mangle]
pub unsafe extern "C" fn engine_step(dt: f32) { engine_mut().step(dt); }

#[no_mangle]
pub unsafe extern "C" fn engine_speed() -> f32 { engine_mut().speed }
#[no_mangle]
pub unsafe extern "C" fn engine_distance() -> f32 { engine_mut().distance }
#[no_mangle]
pub unsafe extern "C" fn engine_lane() -> f32 { engine_mut().lane_offset }
#[no_mangle]
pub unsafe extern "C" fn engine_session_time() -> f32 { engine_mut().session_time }
#[no_mangle]
pub unsafe extern "C" fn engine_lap() -> u32 { let e = engine_mut(); (e.distance / e.track_length).floor() as u32 + 1 }
#[no_mangle]
pub unsafe extern "C" fn engine_lap_time() -> f32 { let e = engine_mut(); e.session_time - e.lap_started_at }
#[no_mangle]
pub unsafe extern "C" fn engine_last_lap() -> f32 { engine_mut().last_lap }
#[no_mangle]
pub unsafe extern "C" fn engine_best_lap() -> f32 { engine_mut().best_lap }
#[no_mangle]
pub unsafe extern "C" fn engine_checkpoint() -> f32 { engine_mut().checkpoint }
#[no_mangle]
pub unsafe extern "C" fn engine_crash_speed() -> f32 { engine_mut().crash_speed }
#[no_mangle]
pub unsafe extern "C" fn engine_event() -> u32 { engine_mut().event }
#[no_mangle]
pub unsafe extern "C" fn engine_corner_distance() -> f32 { engine_mut().corner_distance }
#[no_mangle]
pub unsafe extern "C" fn engine_corner_curvature() -> f32 { engine_mut().corner_curvature }
#[no_mangle]
pub unsafe extern "C" fn engine_corner_safe_kmh() -> f32 { engine_mut().safe_speed_kmh() }
#[no_mangle]
pub unsafe extern "C" fn engine_racer_distance(index: u32) -> f32 { engine_mut().racers[index.min(1) as usize].distance }
#[no_mangle]
pub unsafe extern "C" fn engine_racer_lane(index: u32) -> f32 { let e = engine_mut(); e.racers[index.min(1) as usize].lane_at(e.session_time) }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_keeps_the_selected_line() {
        let mut game = Engine::new(10_000.0, true);
        game.curvature = vec![0.0; 2_000];
        game.start();
        game.steer = 1.0;
        for _ in 0..80 { game.step(0.016); }
        game.steer = 0.0;
        let line = game.lane_offset;
        for _ in 0..120 { game.step(0.016); }
        assert!((game.lane_offset - line).abs() < 1.0);
    }

    #[test]
    fn road_hazard_causes_a_crash() {
        let mut game = Engine::new(10_000.0, true);
        game.curvature = vec![0.0; 2_000];
        game.hazards.push(Hazard { distance: 0.0, offset: 0.0, radius: 1.0 });
        game.start();
        game.throttle = true;
        for _ in 0..200 {
            game.step(0.016);
            if !game.running { break; }
        }
        assert_eq!(game.event, ROCK_STRIKE);
        assert!(game.crash_speed > 0.0);
    }
}
