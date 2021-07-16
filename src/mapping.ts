// Copyright 2019-2021 PureStake Inc.
// This file is part of Moonbridge-Subgraph.

// Moonbridge-Subgraph is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// Moonbridge-Subgraph is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with Moonbridge-Subgraph.  If not, see <http://www.gnu.org/licenses/>.

import {
  RelayerAdded,
  RelayerRemoved,
  Deposit as DepositEvent,
  ProposalEvent,
  Bridge,
  ProposalVote,
  RoleGranted,
} from "./types/Bridge/Bridge";
import { Relayer, Deposit, Proposal, Vote, ProposalCount } from "./types/schema";
import { BigInt, log, store } from "@graphprotocol/graph-ts";

/**
 * Handles the event where a relayer is added to the bridge
 * contract, creating (or updating) a relayer record accordingly
 * @param event
 */
export function handleAddRelayer(event: RelayerAdded): void {
  // The ID of a relayer is its address in hexadecimal format
  let relayerId = event.params.relayer.toHex();

  // The relayer may have been added (and removed) previously
  let relayer = Relayer.load(relayerId);
  if (relayer == null) {
    // If not, create the record
    relayer = new Relayer(relayerId);
  }

  // Set the properties from the event data
  relayer.address = event.params.relayer;
  relayer.addedAt = event.block.timestamp;
  relayer.addedAtBlock = event.block.number;
  relayer.voteCount = BigInt.fromI32(0);

  // Debug the processing
  log.debug("RelayerAdded. Relayer {}", [relayerId]);

  // Save the new relayer record
  relayer.save();
}

/**
 * Handles the event where a relayer is added to the bridge
 * contract, creating (or updating) a relayer record accordingly
 * @param event
 */
 export function handleRoleGranted(event: RoleGranted): void {
  // We connect to the bridge contract on-chain to read the
  // RelayerRole, which is a public property of the contract
  let bridgeContract = Bridge.bind(event.address);
  let relayerRole = bridgeContract.RELAYER_ROLE();
  
  // We get the role assigned on the contract
  let role = event.params.role;

  // If the role is not a relayer, no need to process -> exit
  if (!relayerRole.equals(role)) return;

  // The ID of a relayer is its address in hexadecimal format
  let relayerId = event.params.account.toHex();

  // The relayer may have been added (and removed) previously
  let relayer = Relayer.load(relayerId);
  if (relayer == null) {
    // If not, create the record
    relayer = new Relayer(relayerId);
  }

  // Set the properties from the event data
  relayer.address = event.params.account;
  relayer.addedAt = event.block.timestamp;
  relayer.addedAtBlock = event.block.number;
  relayer.voteCount = BigInt.fromI32(0);

  // Debug the processing
  log.debug("RoleGranted (RelayerAdded). Relayer {}", [relayerId]);

  // Save the new relayer record
  relayer.save();
}


/**
 * Handles the event where a relayer is removed to the bridge
 * contract, updating the related relayer record as non-active
 * @param event
 */
export function handleRemoveRelayer(event: RelayerRemoved): void {
  // The ID of a relayer is its address in hexadecimal format
  let relayerId = event.params.relayer.toHex();

  // Debug the processing
  log.debug("RelayerRemoved. Relayer {}.", [relayerId]);

  store.remove('Relayer', relayerId);
}

/**
 * Handles the event where a user has submitted a new deposit
 * to be sent through the bridge, creating a new deposit
 * record accordingly
 * @param event
 */
export function handleNewDeposit(event: DepositEvent): void {
  // We connect to the bridge contract on-chain to read the
  // origin chainId, which is a public property of the contract
  let bridgeContract = Bridge.bind(event.address);

  // The deposit event always happens on the "origin" side of the bridge
  let originChainId = BigInt.fromI32(bridgeContract._chainID());
  let destinationChainId = BigInt.fromI32(event.params.destinationChainID);

  // The ID of a deposit is composed by the chains involved and the
  // nonce of this deposit
  let depositId =
    originChainId.toString() +
    "->" +
    destinationChainId.toString() +
    "-" +
    event.params.depositNonce.toString();

  // The deposit is always created new, as the nonce must be different between them
  let deposit = new Deposit(depositId);

  // Set the properties from the event and the contract data
  deposit.originChainId = bridgeContract._chainID();
  deposit.destinationChainId = event.params.destinationChainID;
  deposit.resourceId = event.params.resourceID;
  deposit.nonce = event.params.depositNonce;
  deposit.createdAt = event.block.timestamp;

  // Debug the processing
  log.debug("DepositEvent. From: {}. To {}. Nonce {}.", [
    originChainId.toString(),
    destinationChainId.toString(),
    event.params.depositNonce.toString(),
  ]);

  // Save the new deposit record
  deposit.save();
}

/**
 * Handles the event where a relayer creates (or updates the status of) a proposal,
 * creating (or updating) a proposal&deposit records.
 * @param event
 */
export function handleProposalEvent(event: ProposalEvent): void {
  // We connect to the bridge contract on-chain to read the
  // origin chainId, which is a public property of the contract
  let bridgeContract = Bridge.bind(event.address);

  // The proposal event always happens on the "destination" side of the bridge
  let destinationChainId = BigInt.fromI32(bridgeContract._chainID());
  let originChainId = BigInt.fromI32(event.params.originChainID);

  // The ID of a deposit (and a proposal) is composed by the chains involved and the
  // nonce of this deposit
  let depositId =
    originChainId.toString() +
    "->" +
    destinationChainId.toString() +
    "-" +
    event.params.depositNonce.toString();
  let proposalId = depositId;
  let proposalCountId = 
    originChainId.toString() +
    "->" +
    destinationChainId.toString();

  // We receive this event multiple times, not only when a proposal is created, so we
  // may need to load the deposit
  let deposit = Deposit.load(depositId);
  if (deposit == null) {
    deposit = new Deposit(depositId);

    // Set the properties from the event and the contract data
    deposit.originChainId = event.params.originChainID;
    deposit.destinationChainId = bridgeContract._chainID();
    deposit.resourceId = event.params.resourceID;
    deposit.nonce = event.params.depositNonce;
    deposit.createdAt = event.block.timestamp;
    deposit.proposal = proposalId;

    // Save deposit record
    deposit.save();
  }

  // We receive this event multiple times, not only when a proposal is created, so we
  // may need to load the proposal as well
  let proposal = Proposal.load(proposalId);
  if (proposal == null) {
    proposal = new Proposal(proposalId);
    proposal.originChainId = deposit.originChainId;
    proposal.destinationChainId = deposit.destinationChainId;
    proposal.resourceId = deposit.resourceId;
    proposal.dataHash = event.params.dataHash;
    proposal.status = "Inactive";
    proposal.createdAt = event.block.timestamp;
    proposal.createdBy = event.transaction.from.toHex();

    // Load or create the counts of proposals
    let proposalCount = ProposalCount.load(proposalCountId);
    if (proposalCount == null) {
      proposalCount = new ProposalCount(proposalCountId);
      proposalCount.originChainId = deposit.originChainId;
      proposalCount.destinationChainId = deposit.destinationChainId;
      proposalCount.proposalCount = BigInt.fromI32(0);
    }

    // Update the count of proposals of the bridge direction
    proposalCount.proposalCount = proposalCount.proposalCount.plus( BigInt.fromI32(1) );

    // Save the changes on the count
    proposalCount.save();
  }

  // Save the previous status of the proposal to display it later on the logs
  let previousStatus = proposal.status;

  // Map the status (integer) to the status message (string) to be stored
  // within the record. If the new status is Passed/Executed/Cancelled,
  // update the correspondent timestamp
  if (event.params.status == 0) proposal.status = "Inactive";
  if (event.params.status == 1) proposal.status = "Active";
  if (event.params.status == 2) {
    proposal.status = "Passed";
    proposal.passedAt = event.block.timestamp;
    proposal.passedBy = event.transaction.from.toHex();
  }
  if (event.params.status == 3) {
    proposal.status = "Executed";
    proposal.executedAt = event.block.timestamp;
    proposal.executedBy = event.transaction.from.toHex();
  }
  if (event.params.status == 4) {
    proposal.status = "Cancelled";
    proposal.cancelledAt = event.block.timestamp;
    proposal.cancelledBy = event.transaction.from.toHex();
  }

  // Debug the processing
  log.debug("ProposalEvent. From: {}. To {}. Nonce {}. Status {} -> {}.", [
    originChainId.toString(),
    destinationChainId.toString(),
    event.params.depositNonce.toString(),
    previousStatus,
    proposal.status,
  ]);

  // Save the proposal record
  proposal.save();
}

/**
 * Handles the event where a relayer votes in one of the previously created proposals,
 * creating the vote record with the event data
 * @param event
 */
export function handleProposalVote(event: ProposalVote): void {
  // We grab the sender of the vote, which is the relayer who emitted the vote
  let sender = event.transaction.from;

  // We connect to the bridge contract on-chain to read the
  // origin chainId, which is a public property of the contract
  let bridgeContract = Bridge.bind(event.address);

  // The vote event always happens on the "destination" side of the bridge
  let destinationChainId = BigInt.fromI32(bridgeContract._chainID());
  let originChainId = BigInt.fromI32(event.params.originChainID);

  // The ID of a proposal is composed by the chains involved and the
  // nonce of the correspondent deposit
  let proposalId =
    originChainId.toString() +
    "->" +
    destinationChainId.toString() +
    "-" +
    event.params.depositNonce.toString();

  // The ID of a vote is composed by the proposalId that is being voted and
  // the relayer address that is voting
  let voteId = proposalId + "-" + sender.toHex();

  // The vote is always created new, as relayers can only vote once
  let vote = new Vote(voteId);

  // Set the properties from the event and the contract data
  vote.relayer = sender.toHex();
  vote.proposal = proposalId;
  vote.isYesVote = true;
  vote.isNoVote = false; // ATM the contract only handles "yes" votes
  vote.votedAt = event.block.timestamp;

  // Debug the processing
  log.debug("ProposalVote. From: {}. Proposal {}.", [
    event.transaction.from.toHex(),
    proposalId,
  ]);

  // Save the vote record
  vote.save();

  // Load the relayer who made the vote
  let relayer = Relayer.load(sender.toHex());
  
  // Increment the count of votes - Needed because the query is limited to 1k records, 
  // so checking the length of the result may lead to wrong values
  relayer.voteCount = relayer.voteCount.plus( BigInt.fromI32(1) );

  // Save changes to relayer
  relayer.save();
}
