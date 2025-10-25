use std::collections::HashMap;
use std::fmt::Debug;
use std::hash::Hash;
use std::time::Duration;

use hydro_lang::live_collections::stream::{AtLeastOnce, NoOrder, TotalOrder};
use hydro_lang::location::cluster::CLUSTER_SELF_ID;
use hydro_lang::location::{Atomic, Location, MemberId};
use hydro_lang::prelude::*;
use hydro_std::quorum::{collect_quorum, collect_quorum_with_response};
use hydro_std::request_response::join_responses;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

// use super::paxos_with_client::PaxosLike; // Commented out - not available in test fixture

// Placeholder trait for testing
pub trait PaxosLike<'a> {
    type PaxosIn;
    type PaxosLog;
    type PaxosOut;
    type Ballot;
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Proposer {}
pub struct Acceptor {}

#[derive(Clone, Copy)]
pub struct PaxosConfig {
    /// Maximum number of faulty nodes
    pub f: usize,
    /// How often to send "I am leader" heartbeats
    pub i_am_leader_send_timeout: u64,
    /// How often to check if the leader has expired
    pub i_am_leader_check_timeout: u64,
    /// Initial delay, multiplied by proposer pid, to stagger proposers checking for timeouts
    pub i_am_leader_check_timeout_delay_multiplier: usize,
}

pub trait PaxosPayload: Serialize + DeserializeOwned + PartialEq + Eq + Clone + Debug {}
impl<T: Serialize + DeserializeOwned + PartialEq + Eq + Clone + Debug> PaxosPayload for T {}

#[derive(Serialize, Deserialize, PartialEq, Eq, Copy, Clone, Debug, Hash)]
pub struct Ballot {
    pub num: u32,
    pub proposer_id: MemberId<Proposer>,
}

impl Ord for Ballot {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.num
            .cmp(&other.num)
            .then_with(|| self.proposer_id.raw_id.cmp(&other.proposer_id.raw_id))
    }
}

impl PartialOrd for Ballot {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LogValue<P> {
    pub ballot: Ballot,
    pub value: Option<P>, // might be a hole
}

#[derive(Serialize, Deserialize, PartialEq, Eq, Clone, Debug)]
pub struct P2a<P, S> {
    pub sender: MemberId<S>,
    pub ballot: Ballot,
    pub slot: usize,
    pub value: Option<P>, // might be a re-committed hole
}

pub struct CorePaxos<'a> {
    pub proposers: Cluster<'a, Proposer>,
    pub acceptors: Cluster<'a, Acceptor>,
    pub paxos_config: PaxosConfig,
}
