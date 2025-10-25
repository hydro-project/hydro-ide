use hydro_lang::location::cluster::CLUSTER_SELF_ID;
use hydro_lang::location::{MemberId, MembershipEvent};
use hydro_lang::prelude::*;
use hydro_std::compartmentalize::{DecoupleClusterStream, DecoupleProcessStream, PartitionStream};
use stageleft::IntoQuotedMut;

pub fn partition<'a, F: Fn((MemberId<()>, String)) -> (MemberId<()>, String) + 'a>(
    cluster1: Cluster<'a, ()>,
    cluster2: Cluster<'a, ()>,
    dist_policy: impl IntoQuotedMut<'a, F, Cluster<'a, ()>>,
) -> (Cluster<'a, ()>, Cluster<'a, ()>) {
    cluster1
        .source_iter(q!(vec!(CLUSTER_SELF_ID)))
        .map(q!(move |id| (
            MemberId::<()>::from_raw(id.raw_id),
            format!("Hello from {}", id.raw_id)
        )))
        .send_partitioned(&cluster2, dist_policy)
        .assume_ordering(nondet!(/** testing, order does not matter */))
        .for_each(q!(move |message| println!(
            "My self id is {}, my message is {:?}",
            CLUSTER_SELF_ID.raw_id, message
        )));
    (cluster1, cluster2)
}

pub fn decouple_cluster<'a>(flow: &FlowBuilder<'a>) -> (Cluster<'a, ()>, Cluster<'a, ()>) {
    let cluster1 = flow.cluster();
    let cluster2 = flow.cluster();
    cluster1
        .source_iter(q!(vec!(CLUSTER_SELF_ID)))
        .inspect(q!(|message| println!("Cluster1 node sending message: {}", message)))
        .decouple_cluster(&cluster2)
        .for_each(q!(move |message| println!(
            "My self id is {}, my message is {}",
            CLUSTER_SELF_ID, message
        )));
    (cluster1, cluster2)
}

pub fn decouple_process<'a>(flow: &FlowBuilder<'a>) -> (Process<'a, ()>, Process<'a, ()>) {
    let process1 = flow.process();
    let process2 = flow.process();
    process1
        .source_iter(q!(0..3))
        .decouple_process(&process2)
        .for_each(q!(|message| println!("I received message is {}", message)));
    (process1, process2)
}

pub fn simple_cluster<'a>(flow: &FlowBuilder<'a>) -> (Process<'a, ()>, Cluster<'a, ()>) {
    let process = flow.process();
    let cluster = flow.cluster();

    let numbers = process.source_iter(q!(0..5));
    let ids = process
        .source_cluster_members(&cluster)
        .entries()
        .filter_map(q!(|(i, e)| match e {
            MembershipEvent::Joined => Some(i),
            MembershipEvent::Left => None,
        }));

    ids.cross_product(numbers)
        .map(q!(|(id, n)| (id, (id, n))))
        .demux_bincode(&cluster)
        .inspect(q!(move |n| println!(
            "cluster received: {:?} (self cluster id: {})",
            n, CLUSTER_SELF_ID
        )))
        .send_bincode(&process)
        .entries()
        .assume_ordering(nondet!(/** testing, order does not matter */))
        .for_each(q!(|(id, d)| println!("node received: ({}, {:?})", id, d)));

    (process, cluster)
}
